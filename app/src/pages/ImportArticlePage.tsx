import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Upload } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { saveArticle, MAX_ARTICLE_CHARS } from '../lib/articles'
import { routes } from '../routes'

/**
 * 导入文章页：粘贴/上传 .txt + 字符计数（上限 50000）+ 完成导入
 * AI 处理面板由「导入 AI 处理管道」工单接入（届时保存后先处理再返回列表）
 */
export function ImportArticlePage() {
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
    saveArticle(content, source)
    navigate(routes.articles)
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
          {/* AI 处理面板由「导入 AI 处理管道」工单实现 */}
        </div>
      </div>
    </>
  )
}
