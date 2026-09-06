/**
 * 纯函数：RSS 解析、transcript 清洗、版本哈希、演讲页数据提取。
 *
 * 这些函数不依赖任何 Worker / 网络运行时 API，只做字符串到数据的转换，
 * 因此可以在 vitest（node 环境）下独立、确定性地单元测试。
 * 网络相关逻辑（fetch 演讲页、缓存）放在 src/index.ts。
 */
import type {
  GraphQLResponse,
  NextData,
  PrimaryImage,
  RawTalk,
  Talk,
} from './types'

// ---------------------------------------------------------------------------
// 内部小工具
// ---------------------------------------------------------------------------

/** 提取 RSS item 中某个标签的文本内容（兼容 CDATA 与带属性的起始标签）。 */
function field(item: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = item.match(re)
  if (!m) return ''
  return unwrapCdata(m[1]).trim()
}

/** 去掉 `<![CDATA[ ... ]]>` 包裹；无包裹则原样返回。 */
function unwrapCdata(s: string): string {
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  return m ? m[1] : s
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  copy: '©',
  reg: '®',
  trade: '™',
}

function safeFromCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ''
  try {
    return String.fromCodePoint(n)
  } catch {
    return ''
  }
}

/** HTML 实体解码：先数字（十进制 / 十六进制），后命名实体。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => safeFromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => safeFromCodePoint(parseInt(n, 16)))
    .replace(/&(#x[\da-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, name) =>
      name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : full,
    )
}

/** 去除 HTML 标签、解码实体、折叠空白。 */
function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 将 "mm:ss" 或 "h:mm:ss"（或纯秒数）换算为秒；无法解析返回 0。 */
function parseDuration(s: string): number {
  const parts = s.trim().split(':')
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) return 0
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => Number.isNaN(n))) return 0
  return nums.reduce((acc, n) => acc * 60 + n, 0)
}

/** 从 acast:episodeUrl 的 tid{ID}tid 中提取数字视频 ID。 */
function extractVideoId(episodeUrl: string): string {
  const m = episodeUrl.match(/tid(\d+)tid/)
  return m ? m[1] : ''
}

/** 按 " | " 分割标题与讲者；无分隔符时讲者为空。 */
function splitTitlePresenter(full: string): { title: string; presenter: string } {
  const m = full.match(/^(.*?)\s*\|\s*(.*)$/)
  if (!m) return { title: full.trim(), presenter: '' }
  return { title: m[1].trim(), presenter: m[2].trim() }
}

/** 把 RSS pubDate 转成 ISO 字符串；无法解析时原样返回、空串保持空串。 */
function toIsoDate(raw: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : d.toISOString()
}

/**
 * djb2 字符串哈希 → 8 位十六进制。
 * 同步、确定性、无外部依赖，适合在纯函数中生成版本指纹。
 */
function djb2Hex(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// 导出的纯函数
// ---------------------------------------------------------------------------

/**
 * 解析 TED RSS XML，返回原始演讲数组。
 *
 * 每个 <item> 提取：
 * - title：按 " | " 分割为演讲标题 / 讲者
 * - pubDate：转 ISO 字符串
 * - description：去 HTML 标签、解码实体
 * - itunes:duration：mm:ss / h:mm:ss → 秒
 * - acast:episodeUrl：tid{ID}tid → videoId
 * - link：go.ted.com 短链
 *
 * 缺失字段以空串 / 0 填充，不抛异常；malformed XML 返回空数组。
 */
export function parseRss(xml: string): RawTalk[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []
  return items.map((item) => {
    const fullTitle = decodeEntities(field(item, 'title'))
    const { title, presenter } = splitTitlePresenter(fullTitle)
    const pubDate = toIsoDate(field(item, 'pubDate'))
    const summary = stripHtml(field(item, 'description'))
    const durationSec = parseDuration(field(item, 'itunes:duration'))
    const videoId = extractVideoId(field(item, 'acast:episodeUrl'))
    const link = field(item, 'link')
    return { title, presenter, summary, durationSec, pubDate, videoId, link }
  })
}

/**
 * 清洗 GraphQL transcript 响应为纯文本。
 *
 * - translation 为 null（transcript 未上线）→ 返回空串
 * - 段落内 cues 文本拼接，\n 替换为空格
 * - HTML 实体解码
 * - 段落之间用双换行连接
 */
export function cleanTranscript(data: GraphQLResponse): string {
  const translation = data?.data?.translation
  if (!translation?.paragraphs) return ''
  const paragraphs = translation.paragraphs.map((p) => {
    const text = (p.cues ?? []).map((c) => c.text ?? '').join(' ')
    return decodeEntities(text.replace(/\n/g, ' '))
  })
  return paragraphs.filter((s) => s.length > 0).join('\n\n').trim()
}

/**
 * 根据演讲列表内容计算版本哈希。列表内容变化时版本变化。
 * 哈希输入为各 talk 的 id / title / presenter / pubDate / durationSec 拼接。
 */
export function computeVersion(talks: Talk[]): string {
  const payload = talks
    .map((t) =>
      [t.id, t.title, t.presenter, t.pubDate, t.durationSec].join('\u0001'),
    )
    .join('\n')
  return djb2Hex(payload)
}

/**
 * 从演讲页 HTML 中提取 <script id="__NEXT_DATA__"> 的 JSON。
 * 找不到或解析失败返回 null。
 */
export function extractNextData(html: string): NextData | null {
  const m = html.match(/<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as NextData
  } catch {
    return null
  }
}

/**
 * 从 primaryImageSet 中挑选 16:9 缩略图；无则取第一张；空集返回空串。
 */
export function pickThumbnail(images: PrimaryImage[] | undefined): string {
  if (!images || images.length === 0) return ''
  const wide = images.find((img) => {
    const ratio = img.aspectRatioName ?? ''
    return ratio === '16:9' || ratio === '16x9'
  })
  return (wide ?? images[0]).url
}
