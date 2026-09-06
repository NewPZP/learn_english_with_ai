/**
 * LinguaAI Discover — Cloudflare Worker 入口。
 *
 * 三个端点：
 *   GET /api/channels                                  频道列表（静态）
 *   GET /api/channels/ted/talks?page=1&force=false      分页 TED 演讲
 *   GET /api/channels/ted/talks/:talkId/transcript     清洗后的纯文本 transcript
 *
 * 职责：CORS、token 鉴权、路由、Cache API 缓存（演讲快照 24h / transcript 24h）、
 * 抓取 TED RSS 与演讲页 __NEXT_DATA__ 做富化。纯解析逻辑见 ./parsers。
 */
import {
  computeVersion,
  extractNextData,
  parseRss,
  pickThumbnail,
  cleanTranscript,
} from './parsers'
import type {
  Channel,
  Env,
  GraphQLResponse,
  RawTalk,
  Talk,
  TalkSnapshot,
} from './types'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Token',
}

const DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 20
/** 并发抓取演讲页的线程数，避免瞬时大量 subrequest。 */
const ENRICH_CONCURRENCY = 6
/** 开发期缺省 token；生产通过 `wrangler secret put API_TOKEN` 覆盖。 */
const DEFAULT_TOKEN = 'dev-token'

const TALKS_CACHE_KEY = 'https://linguaai-discover.internal/talks-snapshot'
const TRANSCRIPT_CACHE_PREFIX = 'https://linguaai-discover.internal/transcript/'

const TED_RSS_URL = 'https://www.ted.com/talks/rss'
const TED_GRAPHQL_URL = 'https://www.ted.com/graphql'

const TRANSCRIPT_QUERY = `query TranscriptQuery($id: ID!, $language: String!) {
  translation(videoId: $id, language: $language) {
    paragraphs {
      cues {
        text
        startTime
        endTime
      }
    }
  }
}
`

// ---------------------------------------------------------------------------
// Worker 入口
// ---------------------------------------------------------------------------

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    // token 鉴权（请求头 X-Api-Token 或 query 参数 token）
    if (!checkToken(request, url, env)) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // 路由
    if (url.pathname === '/api/channels') {
      return json({ channels: getChannels() })
    }

    if (url.pathname === '/api/channels/ted/talks') {
      return handleTalksList(url, ctx)
    }

    const transcriptMatch = url.pathname.match(
      /^\/api\/channels\/ted\/talks\/([^/]+)\/transcript$/,
    )
    if (transcriptMatch) {
      return handleTranscript(transcriptMatch[1], ctx)
    }

    return json({ error: 'Not found' }, 404)
  },
}

// ---------------------------------------------------------------------------
// 鉴权
// ---------------------------------------------------------------------------

function checkToken(request: Request, url: URL, env: Env): boolean {
  const expected = env.API_TOKEN || DEFAULT_TOKEN
  const headerToken = request.headers.get('X-Api-Token')
  const queryToken = url.searchParams.get('token')
  // 常量时间比较，避免时序侧信道
  return (
    (headerToken !== null && safeEqual(headerToken, expected)) ||
    (queryToken !== null && safeEqual(queryToken, expected))
  )
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------------------------------------------------------------------------
// 端点：频道列表
// ---------------------------------------------------------------------------

function getChannels(): Channel[] {
  return [
    {
      id: 'ted',
      name: 'TED Talks',
      description: 'Inspiring talks from TED.',
      icon: 'ted',
      available: true,
    },
    {
      id: 'bbc-learning-english',
      name: 'BBC Learning English',
      description: 'English learning content from BBC. (Coming soon)',
      icon: 'bbc',
      available: false,
    },
    {
      id: 'voa-learning-english',
      name: 'VOA Learning English',
      description: 'American English learning content from VOA. (Coming soon)',
      icon: 'voa',
      available: false,
    },
  ]
}

// ---------------------------------------------------------------------------
// 端点：TED 演讲列表（分页 + 日缓存）
// ---------------------------------------------------------------------------

async function handleTalksList(
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const force = url.searchParams.get('force') === 'true'
  const cache = caches.default

  let snapshot = await readTalksCache(cache)

  if (force) {
    // 绕过缓存：同步抓取最新
    const fresh = await fetchAndEnrichTalks()
    if (fresh) {
      snapshot = fresh
      ctx.waitUntil(writeTalksCache(cache, fresh))
    }
  } else if (!snapshot || isStale(snapshot)) {
    if (!snapshot) {
      // 首次请求（无缓存）：必须同步刷新
      const fresh = await fetchAndEnrichTalks()
      if (fresh) {
        snapshot = fresh
        ctx.waitUntil(writeTalksCache(cache, fresh))
      }
    } else {
      // 缓存过期：先返回旧快照，后台懒刷新
      ctx.waitUntil(
        (async () => {
          const fresh = await fetchAndEnrichTalks()
          if (fresh) await writeTalksCache(cache, fresh)
        })(),
      )
    }
  }

  if (!snapshot) {
    return json({ error: 'Failed to fetch TED talks' }, 502)
  }

  const total = snapshot.talks.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE
  const pageTalks = snapshot.talks.slice(start, start + PAGE_SIZE)

  return json({
    version: snapshot.version,
    talks: pageTalks,
    totalPages,
    currentPage: page,
  })
}

function isStale(snapshot: TalkSnapshot): boolean {
  return Date.now() - snapshot.fetchedAt > DAY_MS
}

async function readTalksCache(cache: Cache): Promise<TalkSnapshot | null> {
  const res = await cache.match(TALKS_CACHE_KEY)
  if (!res) return null
  try {
    return (await res.json()) as TalkSnapshot
  } catch {
    return null
  }
}

async function writeTalksCache(
  cache: Cache,
  snapshot: TalkSnapshot,
): Promise<void> {
  await cache.put(
    TALKS_CACHE_KEY,
    new Response(JSON.stringify(snapshot), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    }),
  )
}

// ---------------------------------------------------------------------------
// RSS 抓取 + 演讲页富化
// ---------------------------------------------------------------------------

async function fetchAndEnrichTalks(): Promise<TalkSnapshot | null> {
  const res = await fetch(TED_RSS_URL)
  if (!res.ok) return null
  const xml = await res.text()
  const rawTalks = parseRss(xml)
  if (rawTalks.length === 0) return null

  const talks = await enrichAll(rawTalks)
  const version = computeVersion(talks)
  return { version, talks, fetchedAt: Date.now() }
}

/** 并发抓取每个 talk 的演讲页，提取缩略图 / 规范 URL / transcript 可用性。 */
async function enrichAll(rawTalks: RawTalk[]): Promise<Talk[]> {
  const results: Talk[] = new Array(rawTalks.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < rawTalks.length) {
      const i = cursor++
      results[i] = await enrichTalk(rawTalks[i])
    }
  }
  const pool = Array.from(
    { length: Math.min(ENRICH_CONCURRENCY, rawTalks.length) },
    () => worker(),
  )
  await Promise.all(pool)
  return results
}

async function enrichTalk(raw: RawTalk): Promise<Talk> {
  if (!raw.videoId || !raw.link) return baseTalk(raw)
  try {
    // go.ted.com 短链 301 → ted.com/talks/{slug}，fetch 自动跟随
    const res = await fetch(raw.link, { redirect: 'follow' })
    if (!res.ok) return baseTalk(raw)
    const html = await res.text()
    const next = extractNextData(html)
    const player = next?.props?.pageProps?.videoData?.videoPlayerData
    const canonicalUrl = player?.canonical ?? res.url
    const thumbnailUrl = pickThumbnail(player?.primaryImageSet)
    const transcriptAvailable = !!next?.props?.pageProps?.transcriptData?.video
      ?.id
    const durationSec = player?.duration ?? raw.durationSec
    return {
      id: raw.videoId,
      title: raw.title,
      presenter: raw.presenter,
      summary: raw.summary,
      durationSec,
      pubDate: raw.pubDate,
      thumbnailUrl,
      canonicalUrl,
      transcriptAvailable,
    }
  } catch {
    return baseTalk(raw)
  }
}

function baseTalk(raw: RawTalk): Talk {
  return {
    id: raw.videoId,
    title: raw.title,
    presenter: raw.presenter,
    summary: raw.summary,
    durationSec: raw.durationSec,
    pubDate: raw.pubDate,
    thumbnailUrl: '',
    canonicalUrl: '',
    transcriptAvailable: false,
  }
}

// ---------------------------------------------------------------------------
// 端点：transcript
// ---------------------------------------------------------------------------

async function handleTranscript(
  talkId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = caches.default
  const key = TRANSCRIPT_CACHE_PREFIX + encodeURIComponent(talkId)

  // 24h 缓存命中直接返回
  const cached = await cache.match(key)
  if (cached) {
    const text = await cached.text()
    return json({ text })
  }

  const text = await fetchTranscript(talkId)
  if (!text) {
    return json({ error: 'Transcript not available' }, 404)
  }

  ctx.waitUntil(
    cache.put(
      key,
      new Response(text, {
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=86400',
        },
      }),
    ),
  )
  return json({ text })
}

async function fetchTranscript(videoId: string): Promise<string> {
  const res = await fetch(TED_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'TranscriptQuery',
      variables: { id: videoId, language: 'en' },
      query: TRANSCRIPT_QUERY,
    }),
  })
  if (!res.ok) return ''
  const data = (await res.json()) as GraphQLResponse
  return cleanTranscript(data)
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  })
}
