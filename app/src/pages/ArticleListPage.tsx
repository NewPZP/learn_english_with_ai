import { Link } from 'react-router-dom'
import { Plus, BookOpen, Headphones, Ear } from 'lucide-react'

const modeEntryStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  height: 40,
  padding: '0 16px',
  borderRadius: 8,
  border: '1px solid var(--en-border)',
  backgroundColor: 'transparent',
  color: 'var(--en-foreground)',
  fontSize: 13,
  fontWeight: 500,
  textDecoration: 'none',
} as const

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
        <Link
          to="/articles/import"
          data-dom-id="cta-import-article"
          style={{
            ...modeEntryStyle,
            border: '1px solid var(--en-primary)',
            backgroundColor: 'var(--en-primary)',
            color: 'var(--en-primary-foreground)',
          }}
        >
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
          <Link to="/articles/1/words" data-dom-id="cta-word-preview" style={modeEntryStyle}>
            <BookOpen size={16} />
            <span>单词预习</span>
          </Link>
          <Link to="/articles/1/podcast" data-dom-id="cta-podcast" style={modeEntryStyle}>
            <Headphones size={16} />
            <span>播客</span>
          </Link>
          <Link to="/articles/1/listening" data-dom-id="cta-intensive-listening" style={modeEntryStyle}>
            <Ear size={16} />
            <span>听力训练</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
