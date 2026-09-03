import { Link } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'

/**
 * 导入文章页（骨架）
 * 预留原型契约锚点：back-article-list（顶栏返回）、cta-save-article（完成导入）
 * 真实表单与 AI 处理由「文章导入」与「AI 处理管道」工单实现
 */
export function ImportArticlePage() {
  return (
    <>
      <header className="page-topbar">
        <Link
          to="/articles"
          className="icon-btn"
          data-dom-id="back-article-list"
          aria-label="返回文章列表"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="page-topbar-title">导入文章</h1>
        <span style={{ width: 36 }} />
      </header>
      <div className="app-content-inner">
        <div className="page-skeleton" data-testid="page-skeleton">
          <span className="page-skeleton-title">导入文章</span>
          <span className="page-skeleton-hint">
            粘贴/上传表单与 AI 处理预览将在后续工单中实现
          </span>
          <Link
            to="/articles"
            data-dom-id="cta-save-article"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 40,
              padding: '0 16px',
              borderRadius: 8,
              border: '1px solid var(--en-primary)',
              backgroundColor: 'var(--en-primary)',
              color: 'var(--en-primary-foreground)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              marginTop: 8,
            }}
          >
            <Check size={18} />
            <span>完成导入</span>
          </Link>
        </div>
      </div>
    </>
  )
}
