import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  loadDiscoverConfig,
  saveDiscoverConfig,
  loadCachedTalks,
  saveCachedTalks,
  clearCachedTalks,
  fetchTalks,
  fetchTranscript,
  formatDuration,
  filterByDuration,
  DiscoverError,
  type Talk,
} from './discover'

// ---- 测试数据 ----

const mockTalk = (overrides: Partial<Talk> = {}): Talk => ({
  id: 'talk-1',
  title: 'Test Talk',
  presenter: 'Test Speaker',
  summary: 'A summary',
  durationSec: 600,
  pubDate: '2026-09-05T15:00:00Z',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  canonicalUrl: 'https://www.ted.com/talks/test',
  transcriptAvailable: true,
  ...overrides,
})

const mockConfig = {
  workerUrl: 'https://worker.test',
  token: 'test-token',
}

const mockTalksResponse = {
  version: 'abc123',
  talks: [mockTalk()],
  totalPages: 3,
  currentPage: 1,
}

// ---- 测试 ----

describe('发现页 API 客户端', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---- 配置管理 ----

  describe('配置管理', () => {
    test('saveDiscoverConfig → loadDiscoverConfig 读写一致', () => {
      saveDiscoverConfig(mockConfig)
      const loaded = loadDiscoverConfig()
      expect(loaded).toEqual(mockConfig)
    })

    test('未配置时返回 null', () => {
      expect(loadDiscoverConfig()).toBeNull()
    })

    test('损坏数据返回 null', () => {
      localStorage.setItem('linguaai.discover.config', 'not-json')
      expect(loadDiscoverConfig()).toBeNull()
    })
  })

  // ---- 客户端缓存 ----

  describe('客户端缓存', () => {
    test('saveCachedTalks → loadCachedTalks 读写一致', () => {
      const talks = [mockTalk()]
      saveCachedTalks('ted', 'v1', talks, 3)
      const cached = loadCachedTalks('ted')
      expect(cached).not.toBeNull()
      expect(cached!.version).toBe('v1')
      expect(cached!.talks).toEqual(talks)
      expect(cached!.totalPages).toBe(3)
    })

    test('同版本追加 talks（去重）', () => {
      const page1 = [mockTalk({ id: 't1' })]
      const page2 = [mockTalk({ id: 't2' })]
      saveCachedTalks('ted', 'v1', page1, 3)
      saveCachedTalks('ted', 'v1', page2, 3)
      const cached = loadCachedTalks('ted')
      expect(cached!.talks).toHaveLength(2)
      expect(cached!.talks[0].id).toBe('t1')
      expect(cached!.talks[1].id).toBe('t2')
    })

    test('版本变化时替换全部', () => {
      saveCachedTalks('ted', 'v1', [mockTalk({ id: 'old' })], 3)
      saveCachedTalks('ted', 'v2', [mockTalk({ id: 'new' })], 2)
      const cached = loadCachedTalks('ted')
      expect(cached!.talks).toHaveLength(1)
      expect(cached!.talks[0].id).toBe('new')
      expect(cached!.version).toBe('v2')
      expect(cached!.totalPages).toBe(2)
    })

    test('clearCachedTalks 清除指定频道', () => {
      saveCachedTalks('ted', 'v1', [mockTalk()], 3)
      clearCachedTalks('ted')
      expect(loadCachedTalks('ted')).toBeNull()
    })
  })

  // ---- fetchTalks ----

  describe('fetchTalks', () => {
    test('无配置时抛出 DiscoverError', async () => {
      await expect(fetchTalks('ted', 1, false)).rejects.toThrow(DiscoverError)
    })

    test('携带 token 头', async () => {
      saveDiscoverConfig(mockConfig)
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockTalksResponse), { status: 200 }),
      )

      await fetchTalks('ted', 1, false)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [, init] = fetchMock.mock.calls[0]
      expect(init!.headers).toEqual({ 'X-Api-Token': 'test-token' })
    })

    test('请求 URL 含 page 和 force 参数', async () => {
      saveDiscoverConfig(mockConfig)
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockTalksResponse), { status: 200 }),
      )

      await fetchTalks('ted', 2, true)

      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('/api/channels/ted/talks')
      expect(url).toContain('page=2')
      expect(url).toContain('force=true')
    })

    test('版本一致时返回缓存数据（非服务端数据）', async () => {
      saveDiscoverConfig(mockConfig)
      // 预置缓存
      const cachedTalks = [mockTalk({ id: 'cached-1' }), mockTalk({ id: 'cached-2' })]
      saveCachedTalks('ted', 'abc123', cachedTalks, 3)

      // 服务端返回 page 1 但只有 1 条
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockTalksResponse), { status: 200 }),
      )

      const result = await fetchTalks('ted', 1, false)

      // 版本一致 → 返回缓存全量（2 条），不是服务端的 1 条
      expect(result.talks).toHaveLength(2)
      expect(result.talks[0].id).toBe('cached-1')
    })

    test('版本不一致时替换为服务端数据', async () => {
      saveDiscoverConfig(mockConfig)
      // 预置旧版本缓存
      saveCachedTalks('ted', 'old-version', [mockTalk({ id: 'old' })], 3)

      // 服务端返回新版本
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockTalksResponse), { status: 200 }),
      )

      const result = await fetchTalks('ted', 1, false)

      expect(result.version).toBe('abc123')
      expect(result.talks).toHaveLength(1)
      expect(result.talks[0].id).toBe('talk-1')
      // 缓存被更新
      const cached = loadCachedTalks('ted')
      expect(cached!.version).toBe('abc123')
    })

    test('force=true 时绕过版本比对', async () => {
      saveDiscoverConfig(mockConfig)
      // 预置缓存（版本一致）
      saveCachedTalks('ted', 'abc123', [mockTalk({ id: 'cached' })], 3)

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockTalksResponse), { status: 200 }),
      )

      const result = await fetchTalks('ted', 1, true)

      // force → 返回服务端数据，不是缓存
      expect(result.talks[0].id).toBe('talk-1')
    })

    test('401 错误抛出 Token 无效', async () => {
      saveDiscoverConfig(mockConfig)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"error":"Unauthorized"}', { status: 401 }),
      )

      await expect(fetchTalks('ted', 1, false)).rejects.toThrow('Token 无效或已过期')
    })

    test('500 错误抛出服务器错误', async () => {
      saveDiscoverConfig(mockConfig)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"error":"Internal error"}', { status: 500 }),
      )

      await expect(fetchTalks('ted', 1, false)).rejects.toThrow('服务器错误')
    })

    test('网络失败抛出错误', async () => {
      saveDiscoverConfig(mockConfig)
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(fetchTalks('ted', 1, false)).rejects.toThrow()
    })
  })

  // ---- fetchTranscript ----

  describe('fetchTranscript', () => {
    test('成功返回 transcript 文本', async () => {
      saveDiscoverConfig(mockConfig)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ text: 'Hello world.' }), { status: 200 }),
      )

      const text = await fetchTranscript('ted', 'talk-1')
      expect(text).toBe('Hello world.')
    })

    test('404 抛出"文字稿尚未上线"', async () => {
      saveDiscoverConfig(mockConfig)
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"error":"Not found"}', { status: 404 }),
      )

      await expect(fetchTranscript('ted', 'talk-1')).rejects.toThrow('文字稿尚未上线')
    })

    test('无配置时抛出 DiscoverError', async () => {
      await expect(fetchTranscript('ted', 'talk-1')).rejects.toThrow(DiscoverError)
    })
  })

  // ---- 辅助函数 ----

  describe('formatDuration', () => {
    test('5:30 格式（< 1 小时）', () => {
      expect(formatDuration(330)).toBe('5:30')
    })

    test('1:23:45 格式（>= 1 小时）', () => {
      expect(formatDuration(5025)).toBe('1:23:45')
    })

    test('0:00 格式', () => {
      expect(formatDuration(0)).toBe('0:00')
    })
  })

  describe('filterByDuration', () => {
    const talks = [
      mockTalk({ id: 'short', durationSec: 300 }),    // 5min
      mockTalk({ id: 'medium', durationSec: 500 }),    // ~8min
      mockTalk({ id: 'long', durationSec: 900 }),     // 15min
    ]

    test('all 返回全部', () => {
      expect(filterByDuration(talks, 'all')).toHaveLength(3)
    })

    test('short 筛选 ≤6min', () => {
      const result = filterByDuration(talks, 'short')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('short')
    })

    test('medium 筛选 6-12min', () => {
      const result = filterByDuration(talks, 'medium')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('medium')
    })

    test('long 筛选 12min+', () => {
      const result = filterByDuration(talks, 'long')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('long')
    })
  })
})
