import { Link } from 'react-router-dom'
import { Plus, BookOpen, Headphones, Ear } from 'lucide-react'
import { routes } from '../routes'

/**
 * 文章列表页（骨架）
 * 预留原型契约锚点：cta-import-article、cta-word-preview、cta-podcast、cta-intensive-listening
 * 真实卡片网格与数据由「文章导入与列表」工单实现
 */
export function ArticleListPage() {
  return (
    <div className="app-content-inner">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--en-foreground)',
          }}
        >
          文章列表
        </h1>
        <Link to={routes.articleImport} data-dom-id="cta-import-article" className="btn btn-primary">
          <Plus size={18} />
          <span>导入文章</span>
        </Link>
      </header>

      <div className="page-skeleton" data-testid="page-skeleton">
        <span className="page-skeleton-title">文章列表</span>
        <span className="page-skeleton-hint">
          卡片网格与数据将在「文章导入与列表」工单中实现
        </span>

        {/* 学习模式入口锚点预留（真实入口位于文章卡片内，目标页面为骨架） */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Link to={routes.articleWords(1)} data-dom-id="cta-word-preview" className="btn btn-sm">
            <BookOpen size={16} />
            <span>单词预习</span>
          </Link>
          <Link to={routes.articlePodcast(1)} data-dom-id="cta-podcast" className="btn btn-sm">
            <Headphones size={16} />
            <span>播客</span>
          </Link>
          <Link
            to={routes.articleListening(1)}
            data-dom-id="cta-intensive-listening"
            className="btn btn-sm"
          >
            <Ear size={16} />
            <span>听力训练</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
