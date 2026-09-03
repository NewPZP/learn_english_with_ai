/**
 * 文章领域模型与本地持久化
 * AI 处理产物（生词/短语/语音）由「AI 处理管道」工单挂到 Article.processing
 */

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced'

export interface Article {
  id: string
  title: string
  source: string
  content: string
  wordCount: number
  difficulty: Difficulty
  createdAt: string // ISO 日期（yyyy-mm-dd）
}

export const MAX_ARTICLE_CHARS = 50000

const STORAGE_KEY = 'linguaai.articles'

/* ---- 纯函数：文章元数据推导 ---- */

/** 统计英文词数（以空白分隔的 token） */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * 难度启发式：按平均词长粗分级
 * < 4.5 → Beginner；< 5.5 → Intermediate；否则 Advanced
 */
export function estimateDifficulty(text: string): Difficulty {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'Beginner'
  const avgLen = words.reduce((sum, w) => sum + w.length, 0) / words.length
  if (avgLen < 4.5) return 'Beginner'
  if (avgLen < 5.5) return 'Intermediate'
  return 'Advanced'
}

/** 从正文推导标题：首行/首句，去掉句尾标点，截断至 60 字符 */
export function deriveTitle(content: string): string {
  const firstLine = content.trim().split(/\n/)[0]?.trim() ?? ''
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0]?.trim() || firstLine
  const title = firstSentence.replace(/[.!?]+$/, '')
  if (!title) return '未命名文章'
  return title.length > 60 ? `${title.slice(0, 57)}...` : title
}

/* ---- 持久化 ---- */

function generateId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function loadArticles(): Article[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Article[]
  } catch {
    return []
  }
}

export function saveArticle(content: string, source: string): Article {
  const article: Article = {
    id: generateId(),
    title: deriveTitle(content),
    source,
    content: content.slice(0, MAX_ARTICLE_CHARS),
    wordCount: countWords(content),
    difficulty: estimateDifficulty(content),
    createdAt: new Date().toISOString().slice(0, 10),
  }
  const articles = loadArticles()
  localStorage.setItem(STORAGE_KEY, JSON.stringify([article, ...articles]))
  return article
}

export function getArticle(id: string): Article | undefined {
  return loadArticles().find((a) => a.id === id)
}

export function clearArticles(): void {
  localStorage.removeItem(STORAGE_KEY)
}
