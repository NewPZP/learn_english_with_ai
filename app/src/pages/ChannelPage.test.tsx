import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Talk } from '../lib/discover'

// ---- mock discover 模块 ----

const mockTalk = (overrides: Partial<Talk> = {}): Talk => ({
  id: 'talk-1',
  title: 'The Future of Learning',
  presenter: 'Jane Doe',
  summary: 'An inspiring talk about education',
  durationSec: 600,
  pubDate: '2026-09-05T15:00:00Z',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  canonicalUrl: 'https://www.ted.com/talks/test',
  transcriptAvailable: true,
  ...overrides,
})

const mockTalks: Talk[] = [
  mockTalk({ id: 't1', durationSec: 300, title: 'Short Talk' }),
  mockTalk({ id: 't2', durationSec: 500, title: 'Medium Talk' }),
  mockTalk({ id: 't3', durationSec: 900, title: 'Long Talk' }),
]

const mockConfig = { workerUrl: 'https://worker.test', token: 'test-token' }

vi.mock('../lib/discover', () => ({
  loadDiscoverConfig: vi.fn(),
  saveDiscoverConfig: vi.fn(),
  loadCachedTalks: vi.fn(),
  saveCachedTalks: vi.fn(),
  clearCachedTalks: vi.fn(),
  fetchTalks: vi.fn(),
  fetchTranscript: vi.fn(),
  formatDuration: (sec: number) => `${Math.floor(sec / 60)}min`,
  filterByDuration: (talks: Talk[], filter: string) => {
    if (filter === 'all') return talks
    if (filter === 'short') return talks.filter((t) => t.durationSec <= 360)
    if (filter === 'medium') return talks.filter((t) => t.durationSec > 360 && t.durationSec <= 720)
    if (filter === 'long') return talks.filter((t) => t.durationSec > 720)
    return talks
  },
  DURATION_RANGES: { short: [0, 360], medium: [361, 720], long: [721, Infinity] },
  DiscoverError: class DiscoverError extends Error {},
}))

import {
  loadDiscoverConfig,
  clearCachedTalks,
  fetchTalks,
  fetchTranscript,
} from '../lib/discover'
import { loadArticles, saveArticle } from '../lib/articles'
import { ChannelPage } from './ChannelPage'

// ---- IntersectionObserver mock ----

class MockIntersectionObserver {
  private cb: IntersectionObserverCallback
  private elements: Element[] = []

  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
  }

  observe(el: Element) {
    this.elements.push(el)
  }

  disconnect() {}

  trigger() {
    this.cb(
      this.elements.map(
        (target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry,
      ),
      {} as IntersectionObserver,
    )
  }
}

// ---- helpers ----

function renderChannelPage(channelId = 'ted') {
  return render(
    <MemoryRouter initialEntries={[`/discover/${channelId}`]}>
      <Routes>
        <Route path="/discover/:channelId" element={<ChannelPage />} />
        <Route path="/discover" element={<div>Discover Page</div>} />
        <Route path="/articles" element={<div>Article List Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('频道列表页 ChannelPage', () => {
  let mockObserver: MockIntersectionObserver

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(loadDiscoverConfig).mockReturnValue(mockConfig)
    vi.mocked(fetchTalks).mockResolvedValue({
      version: 'v1',
      talks: mockTalks,
      totalPages: 2,
      currentPage: 1,
    })

    mockObserver = new MockIntersectionObserver(() => {})
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) {
        mockObserver = new MockIntersectionObserver(cb)
        return mockObserver
      }
    })
  })

  test('渲染频道标题和 Talk 卡片网格', async () => {
    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('talk-grid')).toBeInTheDocument()
    })

    expect(screen.getByText('Short Talk')).toBeInTheDocument()
    expect(screen.getByText('Medium Talk')).toBeInTheDocument()
    expect(screen.getByText('Long Talk')).toBeInTheDocument()
  })

  test('时长筛选切换可见 Talk', async () => {
    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByText('Short Talk')).toBeInTheDocument()
    })

    // 切换到 short
    act(() => {
      fireEvent.click(screen.getByTestId('filter-short'))
    })
    expect(screen.getByText('Short Talk')).toBeInTheDocument()
    expect(screen.queryByText('Medium Talk')).not.toBeInTheDocument()
    expect(screen.queryByText('Long Talk')).not.toBeInTheDocument()

    // 切换到 long
    act(() => {
      fireEvent.click(screen.getByTestId('filter-long'))
    })
    expect(screen.queryByText('Short Talk')).not.toBeInTheDocument()
    expect(screen.getByText('Long Talk')).toBeInTheDocument()

    // 切换回 all
    act(() => {
      fireEvent.click(screen.getByTestId('filter-all'))
    })
    expect(screen.getByText('Short Talk')).toBeInTheDocument()
    expect(screen.getByText('Long Talk')).toBeInTheDocument()
  })

  test('刷新按钮触发 force fetch 并清缓存', async () => {
    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('talk-grid')).toBeInTheDocument()
    })

    vi.mocked(fetchTalks).mockClear()
    vi.mocked(fetchTalks).mockResolvedValue({
      version: 'v2',
      talks: [mockTalk({ id: 'new', title: 'New Talk' })],
      totalPages: 1,
      currentPage: 1,
    })

    act(() => {
      fireEvent.click(screen.getByTestId('discover-refresh'))
    })

    await waitFor(() => {
      expect(clearCachedTalks).toHaveBeenCalledWith('ted')
      expect(fetchTalks).toHaveBeenCalledWith('ted', 1, true)
      expect(screen.getByText('New Talk')).toBeInTheDocument()
    })
  })

  test('未配置 Worker 时显示配置引导', () => {
    vi.mocked(loadDiscoverConfig).mockReturnValue(null)
    renderChannelPage()
    expect(screen.getByPlaceholderText('https://your-worker.workers.dev')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Token')).toBeInTheDocument()
    expect(screen.getByText('保存并连接')).toBeInTheDocument()
  })

  test('加载错误时显示错误信息', async () => {
    vi.mocked(fetchTalks).mockRejectedValue(new Error('网络连接失败'))
    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('discover-error')).toHaveTextContent('网络连接失败')
    })
  })

  test('不存在的频道显示提示', () => {
    renderChannelPage('unknown')
    expect(screen.getByText('频道不存在')).toBeInTheDocument()
    expect(screen.getByText('找不到该频道')).toBeInTheDocument()
  })

  test('无限滚动触发下一页加载', async () => {
    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('talk-grid')).toBeInTheDocument()
    })

    // 第二页数据
    vi.mocked(fetchTalks).mockResolvedValue({
      version: 'v1',
      talks: [mockTalk({ id: 't4', title: 'Page 2 Talk' })],
      totalPages: 2,
      currentPage: 2,
    })

    // 触发 IntersectionObserver
    act(() => {
      mockObserver.trigger()
    })

    await waitFor(() => {
      expect(screen.getByText('Page 2 Talk')).toBeInTheDocument()
    })
  })
})

// ---- 加入学习流程测试 ----

describe('加入学习流程', () => {
  let mockObserver: MockIntersectionObserver

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(loadDiscoverConfig).mockReturnValue(mockConfig)
    vi.mocked(fetchTalks).mockResolvedValue({
      version: 'v1',
      talks: [mockTalk()],
      totalPages: 1,
      currentPage: 1,
    })
    vi.mocked(fetchTranscript).mockResolvedValue('This is the transcript text.')

    mockObserver = new MockIntersectionObserver(() => {})
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) {
        mockObserver = new MockIntersectionObserver(cb)
        return mockObserver
      }
    })
  })

  test('点击加入 → 抓取 transcript → 保存文章 → 显示去学习', async () => {
    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('talk-add-talk-1')).toBeInTheDocument()
    })

    act(() => {
      fireEvent.click(screen.getByTestId('talk-add-talk-1'))
    })

    // 先出现 loading 状态
    await waitFor(() => {
      expect(screen.getByTestId('talk-loading-talk-1')).toBeInTheDocument()
    })

    // 完成后变为"去学习"
    await waitFor(() => {
      expect(screen.getByTestId('talk-added-talk-1')).toBeInTheDocument()
    })

    // 验证 fetchTranscript 被调用
    expect(fetchTranscript).toHaveBeenCalledWith('ted', 'talk-1')

    // 验证文章已保存到 localStorage
    const articles = loadArticles()
    expect(articles).toHaveLength(1)
    expect(articles[0].title).toBe('The Future of Learning')
    expect(articles[0].source).toBe('TED · Jane Doe')
    expect(articles[0].sourceUrl).toBe('https://www.ted.com/talks/test')
    expect(articles[0].content).toBe('This is the transcript text.')
  })

  test('已加入的演讲初始显示"去学习"', async () => {
    // 预置已有相同 sourceUrl 的文章
    saveArticle('Existing content.', 'TED · Jane Doe', {
      title: 'The Future of Learning',
      sourceUrl: 'https://www.ted.com/talks/test',
    })

    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('talk-added-talk-1')).toBeInTheDocument()
    })

    // 不应显示"加入学习"按钮
    expect(screen.queryByTestId('talk-add-talk-1')).not.toBeInTheDocument()
  })

  test('transcriptAvailable=false 的演讲显示禁用按钮', async () => {
    vi.mocked(fetchTalks).mockResolvedValue({
      version: 'v1',
      talks: [mockTalk({ id: 'no-transcript', transcriptAvailable: false })],
      totalPages: 1,
      currentPage: 1,
    })

    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('talk-unavailable-no-transcript')).toBeInTheDocument()
    })

    const btn = screen.getByTestId('talk-unavailable-no-transcript') as HTMLButtonElement
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', '文字稿尚未上线')
  })

  test('transcript 抓取失败时显示错误并恢复按钮', async () => {
    vi.mocked(fetchTranscript).mockRejectedValue(new Error('文字稿尚未上线'))

    renderChannelPage()

    await waitFor(() => {
      expect(screen.getByTestId('talk-add-talk-1')).toBeInTheDocument()
    })

    act(() => {
      fireEvent.click(screen.getByTestId('talk-add-talk-1'))
    })

    // 出现错误信息
    await waitFor(() => {
      expect(screen.getByTestId('talk-error-talk-1')).toHaveTextContent('文字稿尚未上线')
    })

    // 按钮恢复为"加入学习"
    expect(screen.getByTestId('talk-add-talk-1')).toBeInTheDocument()
  })

  test('点击"去学习"导航到文章列表', async () => {
    renderChannelPage()

    // 先完成加入
    await waitFor(() => {
      expect(screen.getByTestId('talk-add-talk-1')).toBeInTheDocument()
    })

    act(() => {
      fireEvent.click(screen.getByTestId('talk-add-talk-1'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('talk-added-talk-1')).toBeInTheDocument()
    })

    // 点击"去学习"
    act(() => {
      fireEvent.click(screen.getByTestId('talk-added-talk-1'))
    })

    await waitFor(() => {
      expect(screen.getByText('Article List Page')).toBeInTheDocument()
    })
  })
})
