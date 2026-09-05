/**
 * 文章领域模型与本地持久化
 * AI 处理产物通过 attachProcessing 挂到 Article.processing（由「AI 处理管道」工单产出）
 */
import type { PhraseEntry, Sentence, TtsResult, WordEntry } from './ai/types'

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced'

/** AI 处理产物：供单词预习 / 播客 / 逐句精听等后续页面消费 */
export interface ArticleProcessing {
  words: WordEntry[]
  phrases: PhraseEntry[]
  sentences: Sentence[]
  /** 整篇 TTS 语音产物（播客/精听音源）；早期数据可能缺失 */
  audio?: TtsResult
}

export interface Article {
  id: string
  title: string
  source: string
  content: string
  wordCount: number
  difficulty: Difficulty
  createdAt: string // ISO 日期（yyyy-mm-dd）
  /** AI 处理管道完成后写入；未处理的文章缺失该字段 */
  processing?: ArticleProcessing
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

function persist(articles: Article[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(articles))
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
  persist([article, ...articles])
  return article
}

export function getArticle(id: string): Article | undefined {
  return loadArticles().find((a) => a.id === id)
}

/** 将 AI 处理产物持久化并关联到文章；返回更新后的文章（找不到时返回 undefined） */
export function attachProcessing(articleId: string, processing: ArticleProcessing): Article | undefined {
  const articles = loadArticles()
  const target = articles.find((a) => a.id === articleId)
  if (!target) return undefined
  target.processing = processing
  persist(articles)
  return target
}

/** 按 ID 删除单篇文章；返回是否成功删除（ID 不存在时返回 false） */
export function deleteArticle(id: string): boolean {
  const articles = loadArticles()
  const target = articles.find((a) => a.id === id)
  if (!target) return false
  persist(articles.filter((a) => a.id !== id))
  return true
}

export function clearArticles(): void {
  localStorage.removeItem(STORAGE_KEY)
}
