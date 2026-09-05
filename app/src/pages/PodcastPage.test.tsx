import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PodcastPage } from './PodcastPage'
import type { AudioLike } from '../lib/audio/useSentencePlayer'

/**
 * 深入学习页验收测试（页面级，注入假音频）
 * 覆盖：信息卡、播放/暂停、字幕高亮同步、上下句/重复/倍速、进度条、
 * Tab 切换（挖空听写/听力挑战）、子模式（整篇/逐句）、三档难度、
 * 整词输入即判分（失焦/回车）、重新编辑清除判分
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

describe('深入学习页 — 初始渲染', () => {
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

  test('字幕区渲染全部句子，首句当前高亮', () => {
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.getAllByTestId(/^subtitle-line-/)).toHaveLength(3)
    expect(screen.getByTestId('subtitle-line-0').className).toContain('current')
  })

  test('默认显示「挖空听写」Tab，含三档难度、全文开关与播放模式', () => {
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.getByRole('button', { name: '挖空听写' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'AI 综合测验' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('全部听写')).toBeInTheDocument()
    expect(screen.getByText('重要词语')).toBeInTheDocument()
    expect(screen.getByText('仅生词')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '显示全文' })).toHaveAttribute('aria-pressed', 'false')
    // 播放模式位于播放控制区，默认连续播放
    expect(screen.getByRole('button', { name: '连续播放' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '单句播放' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('深入学习页 — 播放与字幕同步', () => {
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

  test('字幕高亮随播放切换，时间推进', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    await user.click(screen.getByTestId('play-pause'))
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:00')

    act(() => fake.tick(10))
    expect(screen.getByTestId('subtitle-line-1').className).toContain('current')
    expect(screen.getByTestId('subtitle-line-0').className).not.toContain('current')
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

describe('深入学习页 — 句级控制与倍速', () => {
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

  test('拖拽进度条定位（range change → seek）', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    const slider = screen.getByTestId('progress-slider')
    await user.type(slider, '{ArrowRight}')
    expect(screen.getByTestId('current-time')).toHaveTextContent('0:00')
  })
})

describe('深入学习页 — Tab 与子模式切换', () => {
  beforeEach(() => localStorage.clear())

  test('切换到「AI 综合测验」Tab，再切回「挖空听写」', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByRole('button', { name: 'AI 综合测验' }))
    expect(screen.getByRole('button', { name: 'AI 综合测验' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('subtitle-area')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '挖空听写' }))
    expect(screen.getByRole('button', { name: '挖空听写' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('subtitle-area')).toBeInTheDocument()
  })

  test('播放模式：连续播放/单句播放切换', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.getByRole('button', { name: '连续播放' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '单句播放' }))
    expect(screen.getByRole('button', { name: '单句播放' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '连续播放' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('三档难度切换', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.getByText('重要词语').closest('button')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByText('全部听写'))
    expect(screen.getByText('全部听写').closest('button')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByText('仅生词'))
    expect(screen.getByText('仅生词').closest('button')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('深入学习页 — 整词挖空输入与即判分', () => {
  beforeEach(() => localStorage.clear())

  test('「全部听写」难度下首句所有词元变为输入框', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('全部听写'))
    // 首句 "So I want to start with a story about a guy." → 11 个词元
    expect(screen.getAllByTestId(/^blank-0-/)).toHaveLength(11)
  })

  test('输入正确答案失焦后判为正确（绿色），错误判为错误（红色）', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('全部听写'))
    const input = screen.getByTestId('blank-0-0')

    await user.type(input, 'so')
    await user.tab() // blur → grade
    expect(input.className).toContain('blank-correct')

    await user.clear(input)
    await user.type(input, 'xyz')
    await user.tab()
    expect(input.className).toContain('blank-wrong')
  })

  test('回车键触发判分', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('全部听写'))
    const input = screen.getByTestId('blank-0-0')

    await user.type(input, 'so{Enter}')
    expect(input.className).toContain('blank-correct')
  })

  test('空格键判定当前空并跳到下一个空', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('全部听写'))
    const first = screen.getByTestId('blank-0-0')
    const second = screen.getByTestId('blank-0-1')

    await user.type(first, 'so ')
    // 当前空判为正确，焦点移到下一个空
    expect(first.className).toContain('blank-correct')
    expect(document.activeElement).toBe(second)
  })

  test('重新编辑已判分的输入会清除判分状态', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('全部听写'))
    const input = screen.getByTestId('blank-0-0')

    await user.type(input, 'so')
    await user.tab()
    expect(input.className).toContain('blank-correct')

    // 重新输入触发 onChange，清除判分
    await user.type(input, 'x')
    expect(input.className).not.toContain('blank-correct')
    expect(input.className).not.toContain('blank-wrong')
  })

  test('显示全文开关：开启后展示原文、隐藏挖空输入', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('全部听写'))
    // 关闭状态：挖空输入框存在
    expect(screen.getByTestId('blank-0-0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '显示全文' }))
    // 开启状态：挖空输入框消失，按钮变为「隐藏全文」
    expect(screen.queryByTestId('blank-0-0')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '隐藏全文' })).toHaveAttribute('aria-pressed', 'true')

    // 再次关闭：挖空输入框恢复
    await user.click(screen.getByRole('button', { name: '隐藏全文' }))
    expect(screen.getByTestId('blank-0-0')).toBeInTheDocument()
  })
})
