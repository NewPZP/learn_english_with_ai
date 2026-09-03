import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, BookOpen, Headphones, Ear, FileText } from 'lucide-react'
import { loadArticles, type Article } from '../lib/articles'
import { routes } from '../routes'

const difficultyClass: Record<Article['difficulty'], string> = {
  Beginner: 'badge beginner',
  Intermediate: 'badge intermediate',
  Advanced: 'badge advanced',
}

/** 卡片内单个进度行（当前为 0% 占位，真实进度由「学习进度闭环」工单接入） */
function ProgressRow({ label, value }: { label: string; value: string }) {
  const percent = parseInt(value, 10)
  return (
    <div className="progress-item">
      <div className="progress-label-row">
        <span className="progress-label">{label}</span>
        <span className="progress-value">{value}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function ArticleCard({ article }: { article: Article }) {
  return (
    <article className="article-card">
      <div className="card-title-row">
        <h2 className="card-title">{article.title}</h2>
        <span className={difficultyClass[article.difficulty]}>{article.difficulty}</span>
      </div>
      <p className="card-source">{article.source}</p>
      <p className="card-meta">
        {article.wordCount.toLocaleString()} words · {article.difficulty} · {article.createdAt}
      </p>

      <div className="progress-section">
        <ProgressRow label="单词预习" value="0%" />
        <ProgressRow label="播客" value="0%" />
        <ProgressRow label="听力训练" value="0%" />
      </div>

      <div className="btn-row">
        <Link
          to={routes.articleWords(article.id)}
          data-dom-id="cta-word-preview"
          className="function-btn function-btn-primary"
        >
          <BookOpen />
          <span>单词预习</span>
        </Link>
        <Link
          to={routes.articlePodcast(article.id)}
          data-dom-id="cta-podcast"
          className="function-btn function-btn-secondary"
        >
          <Headphones />
          <span>播客</span>
        </Link>
        <Link
          to={routes.articleListening(article.id)}
          data-dom-id="cta-intensive-listening"
          className="function-btn function-btn-secondary"
        >
          <Ear />
          <span>听力训练</span>
        </Link>
      </div>
    </article>
  )
}

/**
 * 文章列表页：统计栏 + 双列卡片网格 + 空态
 * 「今日学习分钟数」由「学习进度闭环」工单接入，当前显示 0
 */
export function ArticleListPage() {
  const [articles] = useState(() => loadArticles())

  return (
    <div className="app-content-inner">
      <header className="top-bar">
        <h1 className="top-bar-title">文章列表</h1>
        <Link to={routes.articleImport} data-dom-id="cta-import-article" className="btn btn-primary">
          <Plus size={18} />
          <span>导入文章</span>
        </Link>
      </header>

      <div className="stats-bar">
        <span>已导入 {articles.length} 篇</span>
        <span className="dot" />
        <span>今日学习 0 分钟</span>
      </div>

      {articles.length === 0 ? (
        <div className="empty-state" data-testid="empty-state">
          <FileText size={32} />
          <span className="empty-state-title">还没有文章</span>
          <span className="empty-state-hint">点击右上角「导入文章」开始学习</span>
        </div>
      ) : (
        <div className="article-grid">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  )
}
