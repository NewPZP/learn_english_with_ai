import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { attachProcessing, saveArticle, MAX_ARTICLE_CHARS } from '../lib/articles'
import { getTextAdapter, getVoiceAdapter } from '../lib/ai'
import {
  initialPipelineState,
  runPipeline,
  STEP_ORDER,
  STEP_TITLES,
  type PipelineAdapters,
  type PipelineState,
  type StepStatus,
} from '../lib/processing/pipeline'

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

/**
 * 导入文章页：粘贴/上传 .txt + 字符计数（上限 50000）+ 完成导入
 * 点击「完成导入」后右侧实时展示 AI 处理面板：三步依次流转 + 生词/短语预览
 * 处理通过适配器接口调用（默认 mock），产物持久化关联到文章
 */
export function ImportArticlePage({ adapters }: { adapters?: PipelineAdapters }) {
  const [content, setContent] = useState('')
  const [source, setSource] = useState('粘贴文本')
  const [dragOver, setDragOver] = useState(false)
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null)
  const [running, setRunning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const articleIdRef = useRef<string | null>(null)
  const pipelineContentRef = useRef('')
  const adaptersRef = useRef<PipelineAdapters | null>(null)

  /** 惰性构造一次适配器（测试可注入，默认走工厂取 mock 实现） */
  const getAdapters = (): PipelineAdapters => {
    if (adaptersRef.current === null) {
      adaptersRef.current = adapters ?? { text: getTextAdapter(), voice: getVoiceAdapter() }
    }
    return adaptersRef.current
  }

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

  /** 执行（或从失败步骤续跑）处理管道；完成后产物持久化关联到文章 */
  const startPipeline = async (from: PipelineState) => {
    setRunning(true)
    try {
      const result = await runPipeline(pipelineContentRef.current, getAdapters(), {
        initialState: from,
        onStateChange: setPipelineState,
      })
      if (result.completed && articleIdRef.current) {
        attachProcessing(articleIdRef.current, {
          words: result.words,
          phrases: result.phrases,
          sentences: result.sentences,
        })
      }
    } finally {
      setRunning(false)
    }
  }

  const handleSave = () => {
    if (!content.trim() || running || pipelineState) return
    const article = saveArticle(content, source)
    articleIdRef.current = article.id
    pipelineContentRef.current = article.content
    const initial = initialPipelineState()
    setPipelineState(initial)
    void startPipeline(initial)
  }

  const handleRetry = () => {
    if (running || !pipelineState) return
    void startPipeline(pipelineState)
  }

  const importStarted = pipelineState !== null
  const saveButtonText = running ? 'AI 处理中...' : importStarted ? '已导入' : '完成导入'

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
                disabled={importStarted}
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
              disabled={!content.trim() || importStarted}
            >
              {running ? <Loader2 size={20} className="spinner-icon" /> : <Check size={20} />}
              <span>{saveButtonText}</span>
            </button>
          </div>
          <div className="right-column">
            {pipelineState === null ? (
              <div className="section-card panel-placeholder">
                <Sparkles size={20} />
                <p>点击「完成导入」后，AI 将自动提取生词、短语并生成语音。</p>
              </div>
            ) : (
              <>
                <div className="section-card" data-testid="ai-processing-panel">
                  <div className="panel-header">
                    <Sparkles size={20} />
                    <h2>AI 处理</h2>
                  </div>
                  <div>
                    {STEP_ORDER.map((step) => {
                      const stepState = pipelineState.steps[step]
                      const StepIcon = STEP_ICONS[stepState.status]
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
                          {stepState.status === 'error' && (
                            <button
                              type="button"
                              className="retry-button"
                              onClick={handleRetry}
                              disabled={running}
                              data-dom-id="cta-retry"
                              data-testid={`retry-${step}`}
                            >
                              <RotateCcw size={14} />
                              <span>重试</span>
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
                          <div className="phrase-text">{phrase.phrase}</div>
                          <div className="phrase-translation">{phrase.translation}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
