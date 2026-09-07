import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { getArticle, MAX_ARTICLE_CHARS, mergeProcessing, saveArticle } from '../lib/articles'
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
 * - 有文章 ID（/articles/:id/process）：只读展示正文 + 右侧 AI 处理面板，四步（提取单词/提取短语/获取译文/生成语音）
 *   各自独立触发，互不依赖、可重复执行（重提取覆盖旧产物，不影响其它已完成的产物）。
 */
export function ImportArticlePage({ adapters }: { adapters?: PipelineAdapters }) {
  const { id } = useParams<{ id: string }>()
  if (id) {
    return <ProcessMode articleId={id} adapters={adapters} />
  }
  return <ImportMode />
}

/* ---------------- 导入模式：只存文本 ---------------- */

function ImportMode() {
  // 导入模式只保存纯文本，不触发 AI（用户在卡片点「AI 预处理」进入加工模式）
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [source, setSource] = useState('粘贴文本')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const readTxtFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.txt')) return
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
    if (file) readTxtFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readTxtFile(file)
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
                placeholder="粘贴英文文章内容，或拖拽 .txt 文件到此处..."
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
                  aria-label="上传 .txt 文件"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
                  }}
                >
                  上传 .txt 文件
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt"
                  aria-label="选择 .txt 文件"
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

  const content = boot.content

  /** 执行单个 step；成功后部分合并产物到文章（保留其它已完成产物） */
  const runStep = async (step: StepId) => {
    if (running) return
    setRunning(true)
    setRunningStep(step)
    try {
      const result = await runPipelineStep(content, getAdapters(), step, {
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
                readOnly
                data-dom-id="article-input"
                aria-label="文章正文（只读）"
              />
              <div className="char-count" data-testid="char-count">
                {content.length} / {MAX_ARTICLE_CHARS} 字符
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
