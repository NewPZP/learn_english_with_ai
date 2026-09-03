import { Link, Outlet } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { SidebarNav } from './SidebarNav'
import { routes } from '../routes'

/**
 * 应用布局壳：左侧固定侧边栏（240px）+ 内容区
 * 内容区契约：margin-left 240px，max-width 1200px 居中，padding 24px 32px
 */
export function AppLayout() {
  return (
    <div className="app-shell">
      <SidebarNav />
      <div className="app-content">
        <Outlet />
      </div>
    </div>
  )
}

/** 页面顶栏：返回按钮（back-article-list）+ 居中标题 + 右侧插槽 */
export function PageTopbar({ title }: { title: string }) {
  return (
    <header className="page-topbar">
      <Link
        to={routes.articles}
        className="icon-btn"
        data-dom-id="back-article-list"
        aria-label="返回文章列表"
      >
        <ArrowLeft size={20} />
      </Link>
      <h1 className="page-topbar-title">{title}</h1>
      <span style={{ width: 36 }} />
    </header>
  )
}

/** 页面骨架占位（后续工单填充真实内容） */
export function PageSkeleton({ title }: { title: string }) {
  return (
    <div className="app-content-inner">
      <div className="page-skeleton" data-testid="page-skeleton">
        <span className="page-skeleton-title">{title}</span>
        <span className="page-skeleton-hint">本页面将在后续工单中实现</span>
      </div>
    </div>
  )
}

/** 带返回顶栏的页面骨架 */
export function PageWithTopbarSkeleton({ title }: { title: string }) {
  return (
    <>
      <PageTopbar title={title} />
      <PageSkeleton title={title} />
    </>
  )
}
