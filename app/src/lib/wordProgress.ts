/**
 * 单词预习进度领域模型：三档自评驱动的间隔重复调度 + 本地持久化
 * 记忆曲线档位与复习间隔一一对应：1 / 2 / 4 / 7 / 15 天（艾宾浩斯节点）
 * 存储结构按「文章 × 单词」维度，跨文章复习聚合不在本工单范围
 */

/** 三档自评：不认识 / 模糊 / 认识 */
export type SelfRating = 'unknown' | 'fuzzy' | 'known'

export const RATING_LABELS: Record<SelfRating, string> = {
  unknown: '不认识',
  fuzzy: '模糊',
  known: '认识',
}

/** 记忆曲线 5 个复习节点的间隔天数（下标即档位 stage） */
export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 15] as const

/** 曲线节点展示文案（下标即档位） */
export const MEMORY_CURVE_LABELS = ['1天', '2天', '4天', '7天', '15天'] as const

export const MAX_STAGE = REVIEW_INTERVAL_DAYS.length - 1

/** 单词预习进度记录（latest 自评结果） */
export interface WordProgressRecord {
  word: string
  rating: SelfRating
  /** 复习档位 0..4，对应下次复习间隔 */
  stage: number
  /** 自评时间（ISO） */
  ratedAt: string
  /** 下次复习时间（ISO 日期） */
  nextReviewAt: string
}

const STORAGE_KEY = 'linguaai.word_progress'

/** 全库结构：文章 id → 单词 → 记录 */
type ProgressStore = Record<string, Record<string, WordProgressRecord>>

/* ---- 调度纯函数 ---- */

/**
 * 自评档位推进规则：
 * 认识 → 档位 +1（封顶）；模糊 → 档位不变；不认识 → 归零
 */
export function nextStage(rating: SelfRating, stage: number): number {
  if (rating === 'known') return Math.min(stage + 1, MAX_STAGE)
  if (rating === 'fuzzy') return stage
  return 0
}

/** 计算某次自评后的完整调度结果（档位 + 下次复习日期），now 可注入便于测试 */
export function scheduleNext(
  rating: SelfRating,
  stage: number,
  now: Date = new Date(),
): Pick<WordProgressRecord, 'stage' | 'nextReviewAt'> {
  const next = nextStage(rating, stage)
  const due = new Date(now)
  due.setDate(due.getDate() + REVIEW_INTERVAL_DAYS[next])
  return { stage: next, nextReviewAt: due.toISOString() }
}

/* ---- 统计 ---- */

export interface ProgressStats {
  /** 已评词数 */
  rated: number
  /** 总词数 */
  total: number
  /** 最新自评为「认识」的词数 */
  mastered: number
  /** 最新自评为「不认识/模糊」的词数 */
  toReview: number
}

/**
 * 从记录集合推导统计（records 键为单词）
 * 只统计当前词表内的记录，避免文章重处理后残留的旧记录污染进度
 */
export function computeStats(
  records: Record<string, WordProgressRecord>,
  wordList: string[],
): ProgressStats {
  const inList = wordList.filter((word) => records[word] !== undefined)
  const list = inList.map((word) => records[word])
  return {
    rated: list.length,
    total: wordList.length,
    mastered: list.filter((r) => r.rating === 'known').length,
    toReview: list.filter((r) => r.rating !== 'known').length,
  }
}

/* ---- 持久化 ---- */

function loadStore(): ProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as ProgressStore) : {}
  } catch {
    return {}
  }
}

function persistStore(store: ProgressStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

/** 读取某篇文章的全部单词进度记录 */
export function loadWordProgress(articleId: string): Record<string, WordProgressRecord> {
  return { ...(loadStore()[articleId] ?? {}) }
}

/** 写入一次自评：更新记录、计算下次复习时间并持久化，返回新记录 */
export function rateWord(
  articleId: string,
  word: string,
  rating: SelfRating,
  now: Date = new Date(),
): WordProgressRecord {
  const store = loadStore()
  const articleRecords = store[articleId] ?? {}
  const previous = articleRecords[word]
  const { stage, nextReviewAt } = scheduleNext(rating, previous?.stage ?? 0, now)
  const record: WordProgressRecord = {
    word,
    rating,
    stage,
    ratedAt: now.toISOString(),
    nextReviewAt,
  }
  store[articleId] = { ...articleRecords, [word]: record }
  persistStore(store)
  return record
}
