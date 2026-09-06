/**
 * 发现页 API 客户端 — 封装 Cloudflare Worker 调用
 * 包含配置管理、客户端缓存（localStorage 版本比对）和错误处理
 */

/* ---- 类型 ---- */

export interface Talk {
  id: string
  title: string
  presenter: string
  summary: string
  durationSec: number
  pubDate: string
  thumbnailUrl: string
  canonicalUrl: string
  transcriptAvailable: boolean
}

export interface TalkListResult {
  version: string
  talks: Talk[]
  totalPages: number
  currentPage: number
}

export interface DiscoverConfig {
  workerUrl: string
  token: string
}

interface CachedTalks {
  version: string
  talks: Talk[]
  totalPages: number
  cachedAt: string
}

/* ---- 配置管理 ---- */

const CONFIG_KEY = 'linguaai.discover.config'

/** 读取 Worker 配置；未配置返回 null */
export function loadDiscoverConfig(): DiscoverConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as DiscoverConfig
    if (!cfg.workerUrl || !cfg.token) return null
    return cfg
  } catch {
    return null
  }
}

/** 保存 Worker 配置 */
export function saveDiscoverConfig(config: DiscoverConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

/* ---- 客户端缓存 ---- */

function cacheKey(channelId: string): string {
  return `linguaai.discover.${channelId}`
}

/** 读取缓存的 talks 数据；无缓存返回 null */
export function loadCachedTalks(channelId: string): CachedTalks | null {
  try {
    const raw = localStorage.getItem(cacheKey(channelId))
    if (!raw) return null
    return JSON.parse(raw) as CachedTalks
  } catch {
    return null
  }
}

/** 写入 talks 缓存（合并已有页数据） */
export function saveCachedTalks(channelId: string, version: string, talks: Talk[], totalPages: number): void {
  const existing = loadCachedTalks(channelId)
  // 版本变化时替换全部；同版本时追加新页
  const merged = existing && existing.version === version
    ? dedupeTalks([...existing.talks, ...talks])
    : talks
  const data: CachedTalks = {
    version,
    talks: merged,
    totalPages,
    cachedAt: new Date().toISOString(),
  }
  localStorage.setItem(cacheKey(channelId), JSON.stringify(data))
}

/** 清除指定频道的缓存 */
export function clearCachedTalks(channelId: string): void {
  localStorage.removeItem(cacheKey(channelId))
}

/* ---- API 调用 ---- */

/** 构建请求 URL */
function buildUrl(config: DiscoverConfig, path: string, params?: Record<string, string | number | boolean>): string {
  const base = config.workerUrl.replace(/\/+$/, '')
  const url = new URL(`${base}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/** 发送请求（携带 token） */
async function discoverFetch(config: DiscoverConfig, path: string, params?: Record<string, string | number | boolean>): Promise<Response> {
  const url = buildUrl(config, path, params)
  return fetch(url, {
    headers: { 'X-Api-Token': config.token },
  })
}

/**
 * 获取频道 talks 列表（含版本比对缓存逻辑）
 * - page=1 且有缓存：fetch page 1 → 版本一致 → 返回缓存全量；版本不一致 → 替换缓存
 * - page>1：fetch 指定页 → 追加到缓存
 * - force=true：绕过缓存比对，直接拉取
 */
export async function fetchTalks(
  channelId: string,
  page: number,
  force: boolean,
): Promise<TalkListResult> {
  const config = loadDiscoverConfig()
  if (!config) throw new DiscoverError('尚未配置 Worker 地址')

  const res = await discoverFetch(config, `/api/channels/${channelId}/talks`, { page, force })
  if (!res.ok) throw await DiscoverError.fromResponse(res)

  const data = await res.json() as TalkListResult

  // 版本比对缓存逻辑（仅 page=1 且非 force 时生效）
  if (page === 1 && !force) {
    const cached = loadCachedTalks(channelId)
    if (cached && cached.version === data.version) {
      // 版本一致 — 用缓存全量数据（可能含已加载的后续页）
      return {
        version: data.version,
        talks: cached.talks,
        totalPages: data.totalPages,
        currentPage: 1,
      }
    }
  }

  // 写入缓存
  saveCachedTalks(channelId, data.version, data.talks, data.totalPages)

  return data
}

/** 获取单篇 transcript 文本 */
export async function fetchTranscript(channelId: string, talkId: string): Promise<string> {
  const config = loadDiscoverConfig()
  if (!config) throw new DiscoverError('尚未配置 Worker 地址')

  const res = await discoverFetch(config, `/api/channels/${channelId}/talks/${talkId}/transcript`)
  if (res.status === 404) throw new DiscoverError('文字稿尚未上线')
  if (!res.ok) throw await DiscoverError.fromResponse(res)

  const data = await res.json() as { text: string }
  return data.text
}

/* ---- 辅助函数 ---- */

/** 秒数 → "12:34" 或 "1:23:45" 格式 */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 时长筛选标签 */
export type DurationFilter = 'all' | 'short' | 'medium' | 'long'

/** 时长筛选区间（秒） */
export const DURATION_RANGES: Record<Exclude<DurationFilter, 'all'>, [number, number]> = {
  short: [0, 360],      // ≤6min
  medium: [361, 720],    // 6-12min
  long: [721, Infinity], // 12min+
}

/** 按时长筛选 talks */
export function filterByDuration(talks: Talk[], filter: DurationFilter): Talk[] {
  if (filter === 'all') return talks
  const [min, max] = DURATION_RANGES[filter]
  return talks.filter((t) => t.durationSec >= min && t.durationSec <= max)
}

/* ---- 内部工具 ---- */

function dedupeTalks(talks: Talk[]): Talk[] {
  const seen = new Set<string>()
  return talks.filter((t) => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
}

/** 发现页错误类型 */
export class DiscoverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscoverError'
  }

  static async fromResponse(res: Response): Promise<DiscoverError> {
    let detail = res.statusText
    try {
      const body = await res.json() as { error?: string }
      if (body.error) detail = body.error
    } catch {
      // 非 JSON 响应
    }
    if (res.status === 401) return new DiscoverError('Token 无效或已过期')
    if (res.status === 500) return new DiscoverError(`服务器错误：${detail}`)
    return new DiscoverError(`请求失败 (${res.status})：${detail}`)
  }
}
