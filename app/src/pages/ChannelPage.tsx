import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { getChannel } from '../lib/channels'
import {
  clearCachedTalks,
  fetchTalks,
  filterByDuration,
  formatDuration,
  loadCachedTalks,
  loadDiscoverConfig,
  saveDiscoverConfig,
  type DurationFilter,
  type Talk,
} from '../lib/discover'
import { routes } from '../routes'

/**
 * TED 频道列表页 — 双列卡片网格 + 时长筛选 + 无限滚动
 */
export function ChannelPage() {
  const { channelId = '' } = useParams()
  const channel = getChannel(channelId)

  // 配置状态
  const [config] = useState(() => loadDiscoverConfig())
  const [configUrl, setConfigUrl] = useState('')
  const [configToken, setConfigToken] = useState('')

  // 数据状态
  const [talks, setTalks] = useState<Talk[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 筛选状态
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('all')

  // 无限滚动
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  // 初始加载
  useEffect(() => {
    if (!config) return // 等待配置
    void loadInitial()
  }, [config, channelId])

  // 无限滚动 observer
  useEffect(() => {
    if (!config || loading) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && currentPage < totalPages && !loadingRef.current) {
          void loadNextPage()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [config, loading, currentPage, totalPages])

  const loadInitial = useCallback(async () => {
    // 先用缓存即时渲染
    const cached = loadCachedTalks(channelId)
    if (cached) {
      setTalks(cached.talks)
      setCurrentPage(1)
      setTotalPages(cached.totalPages)
    }

    setLoading(true)
    setError(null)
    try {
      const result = await fetchTalks(channelId, 1, false)
      // 版本比对后，如果返回的是缓存数据则 talks 与已有一致；否则替换
      if (result.talks.length > 0) {
        setTalks(result.talks)
      }
      setCurrentPage(1)
      setTotalPages(result.totalPages)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  const loadNextPage = useCallback(async () => {
    const nextPage = currentPage + 1
    if (nextPage > totalPages) return
    loadingRef.current = true
    setLoading(true)
    try {
      const result = await fetchTalks(channelId, nextPage, false)
      setTalks((prev) => [...prev, ...result.talks])
      setCurrentPage(nextPage)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [channelId, currentPage, totalPages])

  const handleRefresh = useCallback(async () => {
    clearCachedTalks(channelId)
    setTalks([])
    setCurrentPage(0)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchTalks(channelId, 1, true)
      setTalks(result.talks)
      setCurrentPage(1)
      setTotalPages(result.totalPages)
    } catch (e) {
      setError(e instanceof Error ? e.message : '刷新失败')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  const handleSaveConfig = () => {
    saveDiscoverConfig({ workerUrl: configUrl, token: configToken })
    window.location.reload()
  }

  // 频道不存在
  if (!channel) {
    return (
      <>
        <PageTopbar title="频道不存在" backTo={routes.discover} backLabel="返回发现页" />
        <div className="app-content-inner">
          <p>找不到该频道</p>
        </div>
      </>
    )
  }

  // 未配置 Worker
  if (!config) {
    return (
      <>
        <PageTopbar title={channel.name} backTo={routes.discover} backLabel="返回发现页" />
        <div className="app-content-inner">
          <div className="discover-config-prompt">
            <h2>配置发现页服务</h2>
            <p>输入你的 Cloudflare Worker 地址和 Token 以使用发现页功能</p>
            <input
              className="discover-config-input"
              placeholder="https://your-worker.workers.dev"
              value={configUrl}
              onChange={(e) => setConfigUrl(e.target.value)}
              data-dom-id="discover-config-url"
            />
            <input
              className="discover-config-input"
              placeholder="Token"
              value={configToken}
              onChange={(e) => setConfigToken(e.target.value)}
              data-dom-id="discover-config-token"
            />
            <button
              className="btn-primary"
              onClick={handleSaveConfig}
              disabled={!configUrl || !configToken}
              data-dom-id="discover-config-save"
            >
              保存并连接
            </button>
          </div>
        </div>
      </>
    )
  }

  const filteredTalks = filterByDuration(talks, durationFilter)
  const filters: { value: DurationFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'short', label: '≤6 分钟' },
    { value: 'medium', label: '6-12 分钟' },
    { value: 'long', label: '12 分钟+' },
  ]

  return (
    <>
      <PageTopbar
        title={channel.name}
        backTo={routes.discover}
        backLabel="返回发现页"
        right={
          <button
            className="icon-btn"
            onClick={handleRefresh}
            disabled={loading}
            aria-label="刷新"
            data-testid="discover-refresh"
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
        }
      />
      <div className="app-content-inner">
        {/* 时长筛选 */}
        <div className="discover-filters" role="tablist" aria-label="时长筛选">
          {filters.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={durationFilter === f.value}
              className={`discover-filter-btn ${durationFilter === f.value ? 'active' : ''}`}
              onClick={() => setDurationFilter(f.value)}
              data-testid={`filter-${f.value}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="discover-error" role="alert" data-testid="discover-error">
            {error}
          </div>
        )}

        {/* Talk 卡片网格 */}
        {filteredTalks.length > 0 && (
          <div className="discover-talk-grid" data-testid="talk-grid">
            {filteredTalks.map((talk) => (
              <TalkCard key={talk.id} talk={talk} />
            ))}
          </div>
        )}

        {/* 骨架屏 */}
        {loading && filteredTalks.length === 0 && (
          <div className="discover-talk-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="talk-card-skeleton" data-testid="talk-skeleton" />
            ))}
          </div>
        )}

        {/* 无数据 */}
        {!loading && filteredTalks.length === 0 && !error && (
          <div className="discover-empty">暂无内容</div>
        )}

        {/* 无限滚动哨兵 */}
        {currentPage < totalPages && (
          <div ref={sentinelRef} className="discover-sentinel" data-testid="discover-sentinel" />
        )}
      </div>
    </>
  )
}

/** 单个 Talk 卡片 — 缩略图/标题/讲者/简介/时长/日期 */
function TalkCard({ talk }: { talk: Talk }) {
  return (
    <article className="talk-card" data-testid={`talk-card-${talk.id}`}>
      {talk.thumbnailUrl ? (
        <img
          className="talk-card-thumbnail"
          src={talk.thumbnailUrl}
          alt={talk.title}
          loading="lazy"
        />
      ) : (
        <div className="talk-card-thumbnail-placeholder" />
      )}
      <div className="talk-card-body">
        <h3 className="talk-card-title">{talk.title}</h3>
        <p className="talk-card-presenter">{talk.presenter}</p>
        <p className="talk-card-summary">{talk.summary}</p>
        <div className="talk-card-meta">
          <span className="talk-card-duration">{formatDuration(talk.durationSec)}</span>
          <span className="talk-card-date">{talk.pubDate.slice(0, 10)}</span>
        </div>
      </div>
    </article>
  )
}
