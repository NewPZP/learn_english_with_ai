import { NavLink } from 'react-router-dom'
import { Library, Compass, User, Settings, ChevronDown } from 'lucide-react'

/**
 * 左侧固定侧边栏导航（240px）
 * 导航项：文章 / 发现（占位）/ 我的 → AI 配置
 * 原型契约：「文章」入口带 data-dom-id="back-article-list"，
 * 「AI 配置」入口带 data-dom-id="cta-ai-config"
 */
export function SidebarNav() {
  return (
    <aside className="sidebar-nav">
      <div className="sidebar-brand">
        <span className="sidebar-brand-text">LinguaAI</span>
      </div>
      <nav className="sidebar-menu" aria-label="主导航">
        <NavLink
          to="/articles"
          className="sidebar-nav-btn"
          data-dom-id="back-article-list"
        >
          <Library className="nav-icon" />
          <span>文章</span>
        </NavLink>
        <button type="button" className="sidebar-nav-btn" disabled title="发现（即将上线）">
          <Compass className="nav-icon" />
          <span>发现</span>
        </button>
        <div className="nav-group">
          <div className="nav-group-label">
            <User className="nav-icon" />
            <span>我的</span>
            <ChevronDown className="chevron" />
          </div>
          <NavLink
            to="/ai-config"
            className="sidebar-nav-btn nav-group-item"
            data-dom-id="cta-ai-config"
          >
            <Settings className="nav-icon" />
            <span>AI 配置</span>
          </NavLink>
        </div>
      </nav>
    </aside>
  )
}
