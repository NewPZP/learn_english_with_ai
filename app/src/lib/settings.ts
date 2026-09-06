/**
 * 学习设置领域模型：控制生词本自动收录等学习偏好，本地持久化
 * 目前仅 autoCollectRatings（命中档位的自评自动收入生词本），预留扩展
 */
import type { SelfRating } from './wordProgress'

const STORAGE_KEY = 'linguaai.settings'

export interface LearningSettings {
  /** 命中这些自评档位时自动收入生词本；空数组表示关闭自动收录 */
  autoCollectRatings: SelfRating[]
}

function loadStore(): LearningSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { autoCollectRatings: [] }
    const parsed = JSON.parse(raw)
    const ratings = Array.isArray(parsed?.autoCollectRatings) ? parsed.autoCollectRatings : []
    return { autoCollectRatings: [...ratings] }
  } catch {
    return { autoCollectRatings: [] }
  }
}

function persistStore(settings: LearningSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

/** 读取全部学习设置（始终返回新对象，避免外部 mutation 污染） */
export function loadSettings(): LearningSettings {
  return loadStore()
}

/** 整体覆写学习设置并持久化 */
export function saveSettings(settings: LearningSettings): void {
  persistStore({ autoCollectRatings: settings.autoCollectRatings })
}

/** 单独更新自动收录档位（去重、顺序稳定） */
export function setAutoCollectRatings(ratings: SelfRating[]): LearningSettings {
  const settings = loadStore()
  const next: SelfRating[] = []
  for (const r of ratings) {
    if (!next.includes(r)) next.push(r)
  }
  settings.autoCollectRatings = next
  persistStore(settings)
  return settings
}
