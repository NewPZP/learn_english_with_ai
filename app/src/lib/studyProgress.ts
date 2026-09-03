/**
 * 学习进度闭环领域层（工单 #11）
 * 汇聚三种学习模式的进度数据供文章卡片回显：
 * - 单词预习 x/y：自评记录（wordProgress）
 * - 播客百分比：收听位置 / 音源时长
 * - 听力训练 x/y：逐句精听已提交作答的句子数
 * 以及「今日学习时长」按天累计（跨天归零，由存储日期键保证）
 */
import type { Article } from './articles'
import { computeStats, loadWordProgress } from './wordProgress'

/* ---- 播客收听进度 ---- */

export interface PodcastProgress {
  /** 已收听到的最远位置（毫秒） */
  positionMs: number
  /** 音源总时长（毫秒） */
  durationMs: number
}

const PODCAST_KEY = 'linguaai.podcast_progress'
type PodcastStore = Record<string, PodcastProgress>

function loadPodcastStore(): PodcastStore {
  try {
    const raw = localStorage.getItem(PODCAST_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as PodcastStore) : {}
  } catch {
    return {}
  }
}

/** 读取某篇文章的播客收听进度（未听过为 null） */
export function loadPodcastProgress(articleId: string): PodcastProgress | null {
  return loadPodcastStore()[articleId] ?? null
}

/** 保存播客收听进度（位置钳制在 [0, duration]） */
export function savePodcastProgress(
  articleId: string,
  positionMs: number,
  durationMs: number,
): PodcastProgress {
  const clamped = Math.max(0, Math.min(positionMs, durationMs))
  const record: PodcastProgress = { positionMs: clamped, durationMs }
  const store = loadPodcastStore()
  store[articleId] = record
  localStorage.setItem(PODCAST_KEY, JSON.stringify(store))
  return record
}

/* ---- 听力训练（逐句精听）进度 ---- */

export interface ListeningProgress {
  /** 已提交作答的句子下标（升序去重） */
  completedSentences: number[]
}

const LISTENING_KEY = 'linguaai.listening_progress'
type ListeningStore = Record<string, ListeningProgress>

function loadListeningStore(): ListeningStore {
  try {
    const raw = localStorage.getItem(LISTENING_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as ListeningStore) : {}
  } catch {
    return {}
  }
}

/** 读取某篇文章的精听进度（默认空） */
export function loadListeningProgress(articleId: string): ListeningProgress {
  return { completedSentences: [...(loadListeningStore()[articleId]?.completedSentences ?? [])] }
}

/** 记录一句已完成（重复提交幂等） */
export function markSentenceCompleted(articleId: string, sentenceIndex: number): ListeningProgress {
  const store = loadListeningStore()
  const current = store[articleId]?.completedSentences ?? []
  const next = Array.from(new Set([...current, sentenceIndex])).sort((a, b) => a - b)
  const record: ListeningProgress = { completedSentences: next }
  store[articleId] = record
  localStorage.setItem(LISTENING_KEY, JSON.stringify(store))
  return record
}

/* ---- 今日学习时长 ---- */

const STUDY_TIME_KEY = 'linguaai.study_time'

interface StudyTimeRecord {
  /** 本地日期键 YYYY-MM-DD */
  date: string
  /** 当日累计学习毫秒数 */
  ms: number
}

/** 本地日期键（按用户时区） */
export function dateKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 读取今日累计学习时长（毫秒）；存储日期非今日（跨天）视为 0 */
export function getTodayStudyMs(now: Date = new Date()): number {
  try {
    const raw = localStorage.getItem(STUDY_TIME_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as StudyTimeRecord
    if (!parsed || parsed.date !== dateKey(now) || typeof parsed.ms !== 'number') return 0
    return Math.max(0, parsed.ms)
  } catch {
    return 0
  }
}

/** 累加学习时长到今日（非正数忽略；写入时按当前日期归档，天然跨天归零） */
export function addStudyMs(deltaMs: number, now: Date = new Date()): void {
  if (!(deltaMs > 0)) return
  const record: StudyTimeRecord = { date: dateKey(now), ms: getTodayStudyMs(now) + deltaMs }
  localStorage.setItem(STUDY_TIME_KEY, JSON.stringify(record))
}

/* ---- 三模式进度汇聚（文章卡片消费） ---- */

/** 单模式进度：完成数 / 总数 / 百分比 */
export interface ModeProgress {
  done: number
  total: number
  /** 完成百分比 0-100（total 为 0 时为 0） */
  percent: number
}

export interface ArticleProgress {
  words: ModeProgress
  podcast: ModeProgress
  listening: ModeProgress
}

export function toModeProgress(done: number, total: number): ModeProgress {
  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  }
}

/**
 * 汇聚某篇文章三模式真实进度：
 * 单词预习取自评记录、播客取收听位置、听力训练取已作答句数
 */
export function computeArticleProgress(article: Article): ArticleProgress {
  const wordList = (article.processing?.words ?? []).map((w) => w.word)
  const wordStats = computeStats(loadWordProgress(article.id), wordList)

  const podcast = loadPodcastProgress(article.id)
  const podcastDone = podcast ? Math.min(podcast.positionMs, podcast.durationMs) : 0
  const podcastTotal = podcast?.durationMs ?? 0

  const sentenceTotal = article.processing?.sentences?.length ?? 0
  const listeningDone = loadListeningProgress(article.id).completedSentences.filter(
    (i) => i >= 0 && i < sentenceTotal,
  ).length

  return {
    words: toModeProgress(wordStats.rated, wordStats.total),
    podcast: toModeProgress(podcastDone, podcastTotal),
    listening: toModeProgress(listeningDone, sentenceTotal),
  }
}
