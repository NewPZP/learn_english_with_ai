import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { routes } from '../routes'

/**
 * 导入文章页（骨架）
 * 预留原型契约锚点：back-article-list（顶栏返回）、cta-save-article（完成导入）
 * 真实表单与 AI 处理由「文章导入」与「AI 处理管道」工单实现
 */
export function ImportArticlePage() {
  return (
    <>
      <PageTopbar title="导入文章" />
      <div className="app-content-inner">
        <div className="page-skeleton" data-testid="page-skeleton">
          <span className="page-skeleton-title">导入文章</span>
          <span className="page-skeleton-hint">
            粘贴/上传表单与 AI 处理预览将在后续工单中实现
          </span>
          <Link
            to={routes.articles}
            data-dom-id="cta-save-article"
            className="btn btn-primary"
          >
            <Check size={18} />
            <span>完成导入</span>
          </Link>
        </div>
      </div>
    </>
  )
}
