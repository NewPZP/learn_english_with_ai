import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PodcastPage } from './PodcastPage'
import type { AudioLike } from '../lib/audio/useSentencePlayer'

/**
 * 工单「播客模式」验收测试（页面级，注入假音频）
 * 覆盖：信息卡、播放/暂停、字幕高亮随播放切换、上下句/重复/倍速、点句跳听、列表折叠、跟读开关
 */

const SENTENCES = [
  { text: 'So I want to start with a story about a guy.', startMs: 0, endMs: 8000 },
  { text: 'He was a senior in college, and he was working on his thesis.', startMs: 8000, endMs: 20000 },
  { text: 'And he had been working on it for months.', startMs: 20000, endMs: 35000 },
]

const AUDIO = {
  audioUrl: 'data:audio/wav;base64,x',
  mimeType: 'audio/wav',
  durationMs: 36000,
}

function seedArticle(withAudio = true) {
  localStorage.setItem(
    'linguaai.articles',
    JSON.stringify([
      {
        id: 'a1',
        title: 'Inside the Mind of a Master Procrastinator',
        source: 'Tim Urban · TED Talk',
        content: 'some content',
        wordCount: 1250,
        difficulty: 'Intermediate',
        createdAt: '2026-09-03',
        processing: {
          words: Array.from({ length: 32 }, (_, i) => ({ word: `w${i}` })),
          phrases: Array.from({ length: 8 }, (_, i) => ({ phrase: `p${i}` })),
          sentences: SENTENCES,
          ...(withAudio ? { audio: AUDIO } : {}),
        },
      },
    ]),
  )
}

/** 可控假音频：记录指令、手动 tick 推进 timeupdate */
function createFakeAudio() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    currentTime: 0,
    playbackRate: 1,
    play: () => {},
    pause: () => {},
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(listener)
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    },
    tick(seconds: number) {
      this.currentTime += seconds
      for (const listener of listeners.get('timeupdate') ?? []) listener()
    },
  }
}

type FakeAudio = ReturnType<typeof createFakeAudio>

function renderPage(fake: FakeAudio) {
  return render(
    <MemoryRouter initialEntries={['/articles/a1/podcast']}>
      <Routes>
        <Route
          path="/articles/:id/podcast"
          element={<PodcastPage createAudio={() => fake as unknown as AudioLike} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('播客模式页 — 初始渲染', () => {
  beforeEach(() => localStorage.clear())

  test('文章存在但未生成音频：空态提示并提供「去 AI 预处理」跳转', () => {
    seedArticle(false)
    renderPage(createFakeAudio())
    expect(screen.getByTestId('podcast-empty')).toHaveTextContent('本文尚未生成音频')
    const cta = document.querySelector('[data-dom-id="cta-ai-process"]') as HTMLAnchorElement
    expect(cta).toBeInTheDocument()
    expect(cta.getAttribute('href')).toBe('/articles/a1/process')
    expect(cta).toHaveTextContent('去 AI 预处理')
  })

  test('信息卡：标题/来源/时长/统计徽章', () => {
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.getByText('Inside the Mind of a Master Procrastinator')).toBeInTheDocument()
    expect(screen.getByText('Tim Urban · TED Talk')).toBeInTheDocument()
    expect(screen.getByTestId('total-time')).toHaveTextContent('0:36')
    expect(screen.getByText('1,250 词')).toBeInTheDocument()
    expect(screen.getByText('32 生词')).toBeInTheDocument()
    expect(screen.getByText('8 短语')).toBeInTheDocument()
  })

  test('字幕区渲染全部句子，首句当前高亮；右栏列表同步', () => {
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.getAllByTestId(/^subtitle-line-/)).toHaveLength(3)
    expect(screen.getByTestId('subtitle-line-0').className).toContain('current')
    expect(screen.getAllByTestId(/^sentence-row-/)).toHaveLength(3)
    expect(screen.getByTestId('sentence-row-0').className).toContain('current')
    expect(screen.getByText('3 句')).toBeInTheDocument()
  })
})

describe('播客模式页 — 播放与字幕同步', () => {
  beforeEach(() => localStorage.clear())

  test('播放/暂停切换，播放中当前句显示动画点', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    const playBtn = screen.getByTestId('play-pause')
    expect(playBtn).toHaveAttribute('aria-label', '播放')

    await user.click(playBtn)
    expect(screen.getByTestId('play-pause')).toHaveAttribute('aria-label', '暂停')
    expect(screen.getByTestId('subtitle-line-0').querySelector('.playing-dot')).not.toBeNull()

    await user.click(screen.getByTestId('play-pause'))
    expect(screen.getByTestId('play-pause')).toHaveAttribute('aria-label', '播放')
    expect(screen.getByTestId('subtitle-line-0').querySelector('.playing-dot')).toBeNull()
  })

  test('字幕高亮随播放切换，右侧列表同步高亮，时间推进', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    await user.click(screen.getByTestId('play-pause'))
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:00')

    // 推进 10 秒 → 第二句
    act(() => fake.tick(10))
    expect(screen.getByTestId('subtitle-line-1').className).toContain('current')
    expect(screen.getByTestId('subtitle-line-0').className).not.toContain('current')
    expect(screen.getByTestId('sentence-row-1').className).toContain('current')
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:10')
  })

  test('播放结束停在最后一句并回到暂停态', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    await user.click(screen.getByTestId('play-pause'))
    act(() => fake.tick(40))
    expect(screen.getByTestId('subtitle-line-2').className).toContain('current')
    expect(screen.getByTestId('play-pause')).toHaveAttribute('aria-label', '播放')
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:36')
  })
})

describe('播客模式页 — 句级控制与倍速', () => {
  beforeEach(() => localStorage.clear())

  test('下一句/上一句/重复本句', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    await user.click(screen.getByRole('button', { name: '下一句' }))
    expect(screen.getByTestId('subtitle-line-1').className).toContain('current')
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:08')

    await user.click(screen.getByRole('button', { name: '上一句' }))
    expect(screen.getByTestId('subtitle-line-0').className).toContain('current')

    // 播放到第二句中段 → 重复本句回到句首
    await user.click(screen.getByTestId('play-pause'))
    act(() => fake.tick(12))
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:12')
    await user.click(screen.getByRole('button', { name: '重复本句' }))
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:08')
  })

  test('倍速循环切换 1.0x → 1.5x → 2.0x → 0.5x → 1.0x', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    const speedBtn = screen.getByTestId('speed-button')
    expect(speedBtn).toHaveTextContent('1.0x')

    await user.click(speedBtn)
    expect(speedBtn).toHaveTextContent('1.5x')
    await user.click(speedBtn)
    expect(speedBtn).toHaveTextContent('2.0x')
    await user.click(speedBtn)
    expect(speedBtn).toHaveTextContent('0.5x')
    await user.click(speedBtn)
    expect(speedBtn).toHaveTextContent('1.0x')
  })

  test('点击右栏句子跳听对应句', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    await user.click(screen.getByTestId('sentence-row-2'))
    expect(screen.getByTestId('subtitle-line-2').className).toContain('current')
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:20')
  })

  test('拖拽进度条定位（range change → seek）', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    await user.click(screen.getByTestId('sentence-row-0'))
    const slider = screen.getByTestId('progress-slider')
    await user.type(slider, '{ArrowRight}')
    // 0:00 + 100ms 步进仍在首句区间
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:00')
  })
})

describe('播客模式页 — 面板交互', () => {
  beforeEach(() => localStorage.clear())

  test('句子列表可折叠/展开，aria-expanded 同步', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    const toggle = screen.getByTestId('sentence-list-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('sentence-list')).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('sentence-list')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByTestId('sentence-list')).toBeInTheDocument()
  })

  test('跟读模式开关切换（仅 UI 状态）', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    const toggle = screen.getByTestId('readalong-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).not.toHaveTextContent('· 开')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveTextContent('跟读模式 · 开')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})
