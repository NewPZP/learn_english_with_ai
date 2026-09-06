import { NavLink } from 'react-router-dom'
import { Library, Compass, User, Settings, ChevronDown, BookMarked, Quote, SlidersHorizontal } from 'lucide-react'
import { routes } from '../routes'

/**
 * 左侧固定侧边栏导航（240px）
 * 导航项：文章 / 发现 / 我的 → {生词本, 短语本, 学习设置, AI 配置}
 */
export function SidebarNav() {
  return (
    <aside className="sidebar-nav">
      <div className="sidebar-brand">
        <span className="sidebar-brand-text">LinguaAI</span>
      </div>
      <nav className="sidebar-menu" aria-label="主导航">
        <NavLink
          to={routes.articles}
          className="sidebar-nav-btn"
          data-dom-id="back-article-list"
        >
          <Library className="nav-icon" />
          <span>文章</span>
        </NavLink>
        <NavLink
          to={routes.discover}
          className="sidebar-nav-btn"
          data-dom-id="cta-discover"
        >
          <Compass className="nav-icon" />
          <span>发现</span>
        </NavLink>
        <div className="nav-group">
          <div className="nav-group-label">
            <User className="nav-icon" />
            <span>我的</span>
            <ChevronDown className="chevron" />
          </div>
          <NavLink
            to={routes.vocabWords}
            className="sidebar-nav-btn nav-group-item"
            data-dom-id="cta-vocab-words"
          >
            <BookMarked className="nav-icon" />
            <span>生词本</span>
          </NavLink>
          <NavLink
            to={routes.vocabPhrases}
            className="sidebar-nav-btn nav-group-item"
            data-dom-id="cta-vocab-phrases"
          >
            <Quote className="nav-icon" />
            <span>短语本</span>
          </NavLink>
          <NavLink
            to={routes.settings}
            className="sidebar-nav-btn nav-group-item"
            data-dom-id="cta-settings"
          >
            <SlidersHorizontal className="nav-icon" />
            <span>学习设置</span>
          </NavLink>
          <NavLink
            to={routes.aiConfig}
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
