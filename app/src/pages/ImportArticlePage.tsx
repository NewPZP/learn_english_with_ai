import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import {
  deriveTitle,
  getArticle,
  MAX_ARTICLE_CHARS,
  mergeProcessing,
  saveArticle,
  updateArticleContent,
} from '../lib/articles'
import { getTextAdapter, getVoiceAdapter } from '../lib/ai'
import {
  initialPipelineState,
  runPipelineStep,
  STEP_ORDER,
  STEP_TITLES,
  summarizeStep,
  type PipelineAdapters,
  type PipelineState,
  type StepId,
  type StepStatus,
} from '../lib/processing/pipeline'
import type { ArticleProcessing } from '../lib/articles'
import type { ParsedArticle, ParseOutput, PdfParser } from '../lib/pdf/types'
import { isParseError } from '../lib/pdf/types'
import { alignTranslations, splitChineseIntoSentences, splitIntoSentences } from '../lib/pdf/parse'
import { loadPdf } from '../lib/pdf/loader'
import { routes } from '../routes'

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: '待处理',
  running: '进行中',
  done: '完成',
  error: '失败',
}

const STEP_ICONS: Record<StepStatus, typeof Circle> = {
  pending: Circle,
  running: Loader2,
  done: CheckCircle2,
  error: AlertCircle,
}

/** 各 step 触发按钮的文案（按状态）；命名与 STEP_TITLES 对齐 */
const STEP_ACTION_LABELS: Record<StepId, Record<StepStatus, string>> = {
  words: { pending: '提取关键词汇', running: '处理中', done: '重新提取', error: '重试' },
  phrases: { pending: '提取重点短语', running: '处理中', done: '重新提取', error: '重试' },
  translation: { pending: '获取中文译文', running: '处理中', done: '重新翻译', error: '重试' },
  audio: { pending: '补充语音', running: '处理中', done: '重新生成', error: '重试' },
}

/**
 * 由文章已有 processing 产物推导加工页初始 pipeline 状态：
 * 已有 words → words step done + 摘要；phrases/translation/audio 同理；无产物则 pending。
 * 摘要文案复用 pipeline.summarizeStep，避免与管道双写。进入加工页即见当前加工进度。
 */
function stateFromArticle(processing: ArticleProcessing | undefined): PipelineState {
  const state = initialPipelineState()
  if (!processing) return state
  if (processing.words.length > 0) {
    state.words = [...processing.words]
    state.steps.words = { status: 'done', summary: summarizeStep('words', state) }
  }
  if (processing.phrases.length > 0) {
    state.phrases = [...processing.phrases]
    state.steps.phrases = { status: 'done', summary: summarizeStep('phrases', state) }
  }
  if (processing.sentences.some((s) => s.translation)) {
    state.sentences = [...processing.sentences]
    state.steps.translation = { status: 'done', summary: summarizeStep('translation', state) }
  }
  if (processing.audio) {
    state.audio = { ...processing.audio }
    state.sentences = [...processing.sentences]
    state.steps.audio = { status: 'done', summary: summarizeStep('audio', state) }
  }
  return state
}

/**
 * 导入文章页（双模式）：
 * - 无文章 ID（/articles/import）：粘贴/上传 .txt + 字符计数，点「完成导入」仅保存纯文本，不触发 AI；
 *   保存后导航回文章列表，用户在卡片点「AI 预处理」进入加工。
 * - 有文章 ID（/articles/:id/process）：可编辑正文 + 右侧 AI 处理面板，四步（提取单词/提取短语/获取译文/生成语音）
 *   各自独立触发，互不依赖、可重复执行（重提取覆盖旧产物，不影响其它已完成的产物）；正文编辑需「确认修改」后持久化。
 */
export function ImportArticlePage({ adapters, pdfParser }: {
  adapters?: PipelineAdapters
  pdfParser?: PdfParser
}) {
  const { id } = useParams<{ id: string }>()
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  if (id) {
    return <ProcessMode articleId={id} adapters={adapters} />
  }
  if (pdfFile) {
    return (
      <PdfPreviewMode
        file={pdfFile}
        source={pdfFile.name.replace(/\.pdf$/i, '')}
        onBack={() => setPdfFile(null)}
        pdfParser={pdfParser ?? loadPdf}
      />
    )
  }
  return <ImportMode onPdfSelected={setPdfFile} />
}

/* ---------------- 导入模式：只存文本 ---------------- */

function ImportMode({ onPdfSelected }: { onPdfSelected?: (file: File) => void }) {
  // 导入模式只保存纯文本，不触发 AI（用户在卡片点「AI 预处理」进入加工模式）
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [source, setSource] = useState('粘贴文本')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const readFile = (file: File) => {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.pdf')) {
      onPdfSelected?.(file)
      return
    }
    if (!lower.endsWith('.txt')) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setContent(text.slice(0, MAX_ARTICLE_CHARS))
      setSource(file.name)
    }
    reader.readAsText(file)
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) readFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const handleSave = () => {
    if (!content.trim()) return
    const article = saveArticle(content, source)
    // 保存后直接进入预处理模式，可立即操作提取单词/短语/译文/语音
    navigate(routes.articleProcess(article.id))
  }

  return (
    <>
      <PageTopbar title="导入文章" />
      <div className="app-content-inner">
        <div className="two-column">
          <div className="left-column">
            <div className="section-card">
              <label htmlFor="article-textarea" className="paste-label">粘贴文章内容</label>
              <textarea
                id="article-textarea"
                className={`article-textarea${dragOver ? ' drag-over' : ''}`}
                placeholder="粘贴英文文章内容，或拖拽 .txt / .pdf 文件到此处..."
                maxLength={MAX_ARTICLE_CHARS}
                value={content}
                data-dom-id="article-input"
                onChange={(e) => {
                  setContent(e.target.value.slice(0, MAX_ARTICLE_CHARS))
                  setSource('粘贴文本')
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              />
              <div className="upload-hint">
                <Upload size={16} />
                <span>或</span>
                <span
                  className="upload-link"
                  role="button"
                  tabIndex={0}
                  aria-label="上传 .txt 或 .pdf 文件"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
                  }}
                >
                  上传 .txt / .pdf 文件
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf"
                  aria-label="选择 .txt 或 .pdf 文件"
                  onChange={handleFileChange}
                />
              </div>
              <div className="char-count" data-testid="char-count">
                {content.length} / {MAX_ARTICLE_CHARS} 字符
              </div>
            </div>
            <button
              type="button"
              className="save-button"
              data-dom-id="cta-save-article"
              onClick={handleSave}
              disabled={!content.trim()}
            >
              <Check size={20} />
              <span>完成导入</span>
            </button>
          </div>
          <div className="right-column">
            <div className="section-card panel-placeholder">
              <Sparkles size={20} />
              <p>导入后将自动进入 AI 预处理，可立即提取单词、短语、译文与语音。</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ---------------- 加工模式：单步独立操作 ---------------- */

function ProcessMode({ articleId, adapters }: { articleId: string; adapters?: PipelineAdapters }) {
  const navigate = useNavigate()
  const boot = useMemo(() => getArticle(articleId), [articleId])
  const [pipelineState, setPipelineState] = useState<PipelineState>(() =>
    stateFromArticle(boot?.processing),
  )
  /** 正文草稿：编辑仅更新本地草稿，点「确认修改」后才持久化 */
  const [content, setContent] = useState(boot?.content ?? '')
  /** 已确认持久化的正文（AI 步骤基于此执行） */
  const [savedContent, setSavedContent] = useState(boot?.content ?? '')
  const [running, setRunning] = useState(false)
  const [runningStep, setRunningStep] = useState<StepId | null>(null)
  const [playingAudio, setPlayingAudio] = useState(false)
  const adaptersRef = useRef<PipelineAdapters | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  /** 惰性构造一次适配器（测试可注入，默认走工厂取真实/mock 实现） */
  const getAdapters = (): PipelineAdapters => {
    if (adaptersRef.current === null) {
      adaptersRef.current = adapters ?? { text: getTextAdapter(), voice: getVoiceAdapter() }
    }
    return adaptersRef.current
  }

  if (!boot) {
    return (
      <>
        <PageTopbar title="AI 预处理" />
        <div className="app-content-inner">
          <div className="empty-state">
            <AlertCircle size={32} />
            <span className="empty-state-title">文章不存在</span>
            <span className="empty-state-hint">该文章可能已被删除</span>
            <Link to={routes.articles} className="function-btn function-btn-primary">
              <ArrowLeft size={16} />
              <span>返回列表</span>
            </Link>
          </div>
        </div>
      </>
    )
  }

  // boot 由 useMemo 固定（getArticle 同步读 localStorage，渲染期间不变）；
  // boot 存在时 pipelineState 已由 useState 初始化器推导（非 null），无需补初始化

  /** 编辑正文：截断到上限，仅更新草稿（不持久化） */
  const handleContentChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value.slice(0, MAX_ARTICLE_CHARS))
  }

  /** 是否有未确认的正文修改 */
  const dirty = content !== savedContent

  /** 确认修改：持久化草稿正文并重算词数/难度 */
  const handleConfirmEdit = () => {
    const next = content.slice(0, MAX_ARTICLE_CHARS)
    updateArticleContent(articleId, next)
    setSavedContent(next)
  }

  /** 执行单个 step；成功后部分合并产物到文章（保留其它已完成产物） */
  const runStep = async (step: StepId) => {
    if (running) return
    setRunning(true)
    setRunningStep(step)
    try {
      const result = await runPipelineStep(savedContent, getAdapters(), step, {
        initialState: pipelineState,
        onStateChange: setPipelineState,
      })
      if (result.completed) {
        const partial: Partial<ArticleProcessing> = {}
        if (step === 'words') partial.words = result.words
        else if (step === 'phrases') partial.phrases = result.phrases
        else if (step === 'translation') {
          // 译文写回句子并持久化（精听精读页开关直接复用，避免重复消耗 token）
          partial.sentences = result.sentences
        } else {
          partial.audio = result.audio ?? undefined
          partial.sentences = result.sentences
        }
        mergeProcessing(articleId, partial)
      }
    } finally {
      setRunning(false)
      setRunningStep(null)
    }
  }

  /** 删除单个词汇：更新本地状态并持久化 */
  const removeWord = (word: string) => {
    setPipelineState((prev) => {
      const nextWords = prev.words.filter((w) => w.word !== word)
      mergeProcessing(articleId, { words: nextWords })
      return { ...prev, words: nextWords }
    })
  }

  /** 删除单个短语：更新本地状态并持久化 */
  const removePhrase = (phrase: string) => {
    setPipelineState((prev) => {
      const nextPhrases = prev.phrases.filter((p) => p.phrase !== phrase)
      mergeProcessing(articleId, { phrases: nextPhrases })
      return { ...prev, phrases: nextPhrases }
    })
  }

  /** 试听生成的语音 */
  const handlePreviewAudio = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playingAudio) {
      audio.pause()
      setPlayingAudio(false)
    } else {
      audio.play().catch(() => setPlayingAudio(false))
      setPlayingAudio(true)
    }
  }

  return (
    <>
      <PageTopbar title="AI 预处理" />
      <div className="app-content-inner">
        <div className="two-column">
          <div className="left-column">
            <div className="section-card">
              <div className="paste-label">{boot.title}</div>
              <textarea
                className="article-textarea"
                value={content}
                onChange={handleContentChange}
                data-dom-id="article-input"
                aria-label="文章正文（可编辑）"
              />
              <div className="char-count" data-testid="char-count">
                {content.length} / {MAX_ARTICLE_CHARS} 字符
              </div>
              <div className="edit-actions">
                <button
                  type="button"
                  className="function-btn function-btn-primary"
                  onClick={handleConfirmEdit}
                  disabled={!dirty || !content.trim()}
                  data-dom-id="cta-confirm-edit"
                  data-testid="confirm-edit"
                >
                  <Check size={16} />
                  <span>确认修改</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              className="save-button"
              data-dom-id="cta-back-to-list"
              onClick={() => navigate(routes.articles)}
            >
              <ArrowLeft size={20} />
              <span>返回列表</span>
            </button>
          </div>
          <div className="right-column">
            <div className="section-card" data-testid="ai-processing-panel">
              <div className="panel-header">
                <Sparkles size={20} />
                <h2>AI 处理</h2>
              </div>
              <div>
                {STEP_ORDER.map((step) => {
                  const stepState = pipelineState!.steps[step]
                  const StepIcon = STEP_ICONS[stepState.status]
                  const isRunningThis = runningStep === step
                  const actionLabel = STEP_ACTION_LABELS[step][stepState.status]
                  return (
                    <div className="processing-step" key={step} data-testid={`step-${step}`}>
                      <StepIcon
                        size={20}
                        className={`step-icon step-icon-${stepState.status}${
                          stepState.status === 'running' ? ' spinner-icon' : ''
                        }`}
                      />
                      <div className="step-body">
                        <div className="step-title">{STEP_TITLES[step]}</div>
                        {stepState.status === 'error' ? (
                          <div className="step-error" data-testid={`step-${step}-error`}>
                            {stepState.error}
                          </div>
                        ) : (
                          <div className="step-summary">
                            {stepState.status === 'running' && '正在处理中...'}
                            {stepState.summary}
                          </div>
                        )}
                      </div>
                      <span className={`step-badge step-badge-${stepState.status}`}>
                        {STEP_STATUS_LABELS[stepState.status]}
                      </span>
                      <button
                        type="button"
                        className="retry-button"
                        onClick={() => runStep(step)}
                        disabled={running}
                        data-dom-id={`cta-process-${step}`}
                        data-testid={`process-${step}`}
                      >
                        {isRunningThis ? <Loader2 size={14} className="spinner-icon" /> : <RotateCcw size={14} />}
                        <span>{actionLabel}</span>
                      </button>
                      {step === 'audio' && pipelineState.audio && (
                        <button
                          type="button"
                          className="retry-button"
                          onClick={handlePreviewAudio}
                          data-dom-id="cta-preview-audio"
                          data-testid="preview-audio"
                        >
                          {playingAudio ? <Volume2 size={14} /> : <Play size={14} />}
                          <span>{playingAudio ? '暂停' : '试听'}</span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            {pipelineState.words.length > 0 && (
              <div className="section-card" data-testid="word-preview">
                <div className="panel-header">
                  <h2>词汇预览</h2>
                  <span className="preview-count">{pipelineState.words.length} 词</span>
                </div>
                <div className="vocab-grid">
                  {pipelineState.words.map((word) => (
                    <div className="vocab-chip" key={word.word}>
                      <button
                        type="button"
                        className="vocab-remove-btn"
                        onClick={() => removeWord(word.word)}
                        data-testid={`remove-word-${word.word}`}
                        aria-label={`删除词汇 ${word.word}`}
                      >
                        <X size={12} />
                      </button>
                      <div className="vocab-word">{word.word}</div>
                      <div className="vocab-phonetic">{word.phonetic}</div>
                      <div className="vocab-translation">{word.translation}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {pipelineState.phrases.length > 0 && (
              <div className="section-card" data-testid="phrase-preview">
                <div className="panel-header">
                  <h2>短语预览</h2>
                  <span className="preview-count">{pipelineState.phrases.length} 个</span>
                </div>
                <div>
                  {pipelineState.phrases.map((phrase) => (
                    <div className="phrase-item" key={phrase.phrase}>
                      <button
                        type="button"
                        className="phrase-remove-btn"
                        onClick={() => removePhrase(phrase.phrase)}
                        data-testid={`remove-phrase-${phrase.phrase}`}
                        aria-label={`删除短语 ${phrase.phrase}`}
                      >
                        <X size={12} />
                      </button>
                      <div className="phrase-text">{phrase.phrase}</div>
                      <div className="phrase-translation">{phrase.translation}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {pipelineState.audio && (
              <audio
                ref={audioRef}
                src={pipelineState.audio.audioUrl}
                onEnded={() => setPlayingAudio(false)}
                onPause={() => setPlayingAudio(false)}
                data-testid="preview-audio-element"
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ---------------- PDF 预览模式：确认后批量入库 ---------------- */

type PreviewArticle = ParsedArticle & { selected: boolean }

function toPreviewArticles(parsed: ParsedArticle[]): PreviewArticle[] {
  return parsed.map((a) => ({ ...a, selected: true }))
}

/** 重新对齐：编辑正文后重新切分英文/中文句子并检查数量是否相等 */
function realign(article: PreviewArticle): PreviewArticle {
  if (!article.chineseText) return { ...article, hasTranslation: false, sentences: [] }
  const result = alignTranslations(
    splitIntoSentences(article.content),
    splitChineseIntoSentences(article.chineseText),
  )
  return { ...article, hasTranslation: result.aligned, sentences: result.sentences }
}

/** 合并两篇预览文章为一篇并重新对齐 */
function mergeTwo(a: PreviewArticle, b: PreviewArticle): PreviewArticle {
  return realign({
    ...a,
    title: a.title,
    content: a.content + '\n' + b.content,
    chineseText: a.chineseText + '\n' + b.chineseText,
    sentences: [],
    hasTranslation: false,
    selected: a.selected && b.selected,
  })
}

function PdfPreviewMode({ file, source, onBack, pdfParser }: {
  file: File
  source: string
  onBack: () => void
  pdfParser: PdfParser
}) {
  const navigate = useNavigate()
  const [parseState, setParseState] = useState<'loading' | 'done' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [articles, setArticles] = useState<PreviewArticle[]>([])
  const [mode, setMode] = useState<'multi' | 'single'>('multi')
  const [singleTitle, setSingleTitle] = useState('')
  const [singleContent, setSingleContent] = useState('')
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([])

  useEffect(() => {
    let cancelled = false
    setParseState('loading')
    pdfParser(file)
      .then((result: ParseOutput) => {
        if (cancelled) return
        if (isParseError(result)) {
          setParseState('error')
          setErrorMsg(result.message)
        } else {
          setArticles(toPreviewArticles(result.articles))
          setParseState('done')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setParseState('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [file, pdfParser])

  const switchToSingle = () => {
    if (articles.length > 0) {
      const merged = articles.reduce(mergeTwo)
      setSingleTitle(merged.title)
      setSingleContent(merged.content)
    }
    setMode('single')
  }

  const mergedSentences = useMemo(() => {
    if (mode !== 'single' || !articles.length) return []
    const chineseText = articles.map((a) => a.chineseText).filter(Boolean).join('\n')
    if (!chineseText) return []
    const result = alignTranslations(
      splitIntoSentences(singleContent),
      splitChineseIntoSentences(chineseText),
    )
    return result.aligned ? result.sentences : []
  }, [mode, articles, singleContent])

  const mergedHasTranslation = mergedSentences.length > 0

  const updateArticle = (i: number, updates: Partial<PreviewArticle>) => {
    setArticles((prev) =>
      prev.map((a, j) => (j === i ? { ...a, ...updates } : a)),
    )
  }

  const updateContent = (i: number, content: string) => {
    setArticles((prev) =>
      prev.map((a, j) => (j === i ? realign({ ...a, content }) : a)),
    )
  }

  const mergeWithAbove = (i: number) => {
    if (i === 0) return
    setArticles((prev) => {
      const next = [...prev]
      next[i - 1] = mergeTwo(next[i - 1], next[i])
      next.splice(i, 1)
      return next
    })
  }

  /** 在光标处分割文章为两篇，中文按比例切分后各自重新对齐 */
  const splitAtCursor = (i: number) => {
    const textarea = textareaRefs.current[i]
    if (!textarea) return
    const pos = textarea.selectionStart
    setArticles((prev) => {
      const article = prev[i]
      if (pos <= 0 || pos >= article.content.length) return prev
      const firstContent = article.content.slice(0, pos).trim()
      const secondContent = article.content.slice(pos).trim()
      if (!firstContent || !secondContent) return prev
      const ratio = pos / article.content.length
      const zhPos = Math.floor(article.chineseText.length * ratio)
      const next = [...prev]
      next[i] = realign({ ...article, content: firstContent, chineseText: article.chineseText.slice(0, zhPos) })
      next.splice(i + 1, 0, realign({
        ...article,
        title: deriveTitle(secondContent),
        content: secondContent,
        chineseText: article.chineseText.slice(zhPos),
        selected: article.selected,
      }))
      return next
    })
  }

  const selectedCount = articles.filter(
    (a) => a.selected && a.content.length <= MAX_ARTICLE_CHARS,
  ).length
  const singleOverLimit = singleContent.length > MAX_ARTICLE_CHARS

  const handleConfirm = () => {
    if (mode === 'single') {
      saveArticle(singleContent, source, {
        title: singleTitle || '未命名文章',
        sentences: mergedHasTranslation && mergedSentences.length > 0 ? mergedSentences : undefined,
      })
    } else {
      articles
        .filter((a) => a.selected && a.content.length <= MAX_ARTICLE_CHARS)
        .forEach((a) => {
          saveArticle(a.content, source, {
            title: a.title,
            sentences: a.hasTranslation ? a.sentences : undefined,
          })
        })
    }
    navigate(routes.articles)
  }

  if (parseState === 'loading') {
    return (
      <>
        <PageTopbar title="解析 PDF 中..." />
        <div className="app-content-inner">
          <div className="empty-state">
            <Loader2 size={32} className="spinner-icon" />
            <span className="empty-state-title">正在解析 PDF</span>
            <span className="empty-state-hint">{file.name}</span>
          </div>
        </div>
      </>
    )
  }

  if (parseState === 'error') {
    return (
      <>
        <PageTopbar title="PDF 导入失败" />
        <div className="app-content-inner">
          <div className="empty-state">
            <AlertCircle size={32} />
            <span className="empty-state-title">无法解析此 PDF</span>
            <span className="empty-state-hint">{errorMsg}</span>
            <button
              type="button"
              className="function-btn function-btn-primary"
              onClick={onBack}
              data-dom-id="cta-pdf-back"
            >
              <ArrowLeft size={16} />
              <span>返回重新选择</span>
            </button>
          </div>
        </div>
      </>
    )
  }

  const chineseTextForSingle = articles.map((a) => a.chineseText).filter(Boolean).join('\n')

  return (
    <>
      <PageTopbar title="预览确认导入" />
      <div className="app-content-inner">
        <div className="pdf-preview-toolbar">
          <div className="pdf-mode-toggle">
            <button
              type="button"
              className={`mode-btn${mode === 'multi' ? ' active' : ''}`}
              onClick={() => setMode('multi')}
              data-dom-id="cta-mode-multi"
            >
              按多篇导入
            </button>
            <button
              type="button"
              className={`mode-btn${mode === 'single' ? ' active' : ''}`}
              onClick={switchToSingle}
              data-dom-id="cta-mode-single"
            >
              合并为单篇
            </button>
          </div>
          <FileText size={16} className="pdf-file-icon" />
          <span className="pdf-file-name">{file.name}</span>
          <button
            type="button"
            className="function-btn function-btn-secondary"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
            <span>重新选择</span>
          </button>
        </div>

        <div className="pdf-preview-list">
          {mode === 'multi' && articles.map((article, i) => {
            const overLimit = article.content.length > MAX_ARTICLE_CHARS
            return (
              <div
                className={`pdf-preview-card${overLimit ? ' over-limit' : ''}`}
                key={i}
                data-testid={`pdf-article-${i}`}
              >
                <div className="pdf-card-header">
                  <input
                    type="checkbox"
                    checked={article.selected}
                    onChange={(e) => updateArticle(i, { selected: e.target.checked })}
                    disabled={overLimit}
                    data-testid={`pdf-select-${i}`}
                  />
                  <input
                    type="text"
                    className="pdf-title-input"
                    value={article.title}
                    onChange={(e) => updateArticle(i, { title: e.target.value })}
                    data-testid={`pdf-title-${i}`}
                  />
                  {article.hasTranslation ? (
                    <span className="badge badge-translation">已提取译文</span>
                  ) : article.chineseText ? (
                    <span className="badge badge-no-translation">对齐失败·将降级</span>
                  ) : null}
                  {overLimit && <span className="badge badge-over-limit">超限·禁选</span>}
                </div>
                <textarea
                  ref={(el) => { textareaRefs.current[i] = el }}
                  className="pdf-content-textarea"
                  value={article.content}
                  onChange={(e) => updateContent(i, e.target.value)}
                  data-testid={`pdf-content-${i}`}
                />
                <div className="pdf-card-footer">
                  <span className="char-count">
                    {article.content.length} / {MAX_ARTICLE_CHARS} 字符
                  </span>
                  <div className="pdf-card-actions">
                    <button
                      type="button"
                      className="function-btn function-btn-secondary pdf-merge-btn"
                      onClick={() => splitAtCursor(i)}
                      data-testid={`pdf-split-${i}`}
                    >
                      <Scissors size={14} />
                      <span>在光标处分割</span>
                    </button>
                    {i > 0 && (
                      <button
                        type="button"
                        className="function-btn function-btn-secondary pdf-merge-btn"
                        onClick={() => mergeWithAbove(i)}
                        data-testid={`pdf-merge-${i}`}
                      >
                        合并到上篇
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {mode === 'single' && (
            <div className={`pdf-preview-card${singleOverLimit ? ' over-limit' : ''}`} data-testid="pdf-single-article">
              <div className="pdf-card-header">
                <input
                  type="text"
                  className="pdf-title-input"
                  value={singleTitle}
                  onChange={(e) => setSingleTitle(e.target.value)}
                  data-testid="pdf-single-title"
                />
                {mergedHasTranslation ? (
                  <span className="badge badge-translation">已提取译文</span>
                ) : chineseTextForSingle ? (
                  <span className="badge badge-no-translation">对齐失败·将降级</span>
                ) : null}
                {singleOverLimit && <span className="badge badge-over-limit">超限</span>}
              </div>
              <textarea
                className="pdf-content-textarea"
                value={singleContent}
                onChange={(e) => setSingleContent(e.target.value)}
                data-testid="pdf-single-content"
              />
              <div className="pdf-card-footer">
                <span className="char-count">
                  {singleContent.length} / {MAX_ARTICLE_CHARS} 字符
                </span>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="save-button"
          onClick={handleConfirm}
          disabled={mode === 'multi' ? selectedCount === 0 : singleOverLimit}
          data-dom-id="cta-confirm-pdf-import"
        >
          <Check size={20} />
          <span>
            确认导入{mode === 'multi' ? `（${selectedCount} 篇）` : ''}
          </span>
        </button>
      </div>
    </>
  )
}
