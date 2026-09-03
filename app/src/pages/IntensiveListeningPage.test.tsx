import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IntensiveListeningPage } from './IntensiveListeningPage'
import type { AudioLike } from '../lib/audio/useSentencePlayer'

/**
 * 工单 #9 验收测试（页面级，注入假音频）
 * 覆盖：三档难度切换、逐字母输入（自动前进/退格回退）、提交判分反馈、译文折叠、
 * 上下句导航与进度、统计卡更新、播放当前句
 */

const SENTENCES = [
  {
    text: 'The result of procrastination is not laziness, but the anxiety that builds over time.',
    startMs: 0,
    endMs: 12000,
    translation: '拖延的结果不是懒惰，而是随时间累积的焦虑。',
  },
  {
    text: 'So finally, he decided to pull an all-nighter.',
    startMs: 12000,
    endMs: 20000,
    translation: '所以最后，他决定通宵赶工。',
  },
  { text: 'And he got it done.', startMs: 20000, endMs: 26000, translation: '他最终完成了。' },
]

const WORDS = ['procrastination', 'anxiety']
const PHRASES = ['pull an all-nighter']

const AUDIO = {
  audioUrl: 'data:audio/wav;base64,x',
  mimeType: 'audio/wav',
  durationMs: 26000,
}

function seedArticle(withProcessing = true) {
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
        ...(withProcessing
          ? {
              processing: {
                words: WORDS.map((w) => ({ word: w })),
                phrases: PHRASES.map((p) => ({ phrase: p })),
                sentences: SENTENCES,
                audio: AUDIO,
              },
            }
          : {}),
      },
    ]),
  )
}

/** 可控假音频（与播客页测试同构） */
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
    <MemoryRouter initialEntries={['/articles/a1/listening']}>
      <Routes>
        <Route
          path="/articles/:id/listening"
          element={<IntensiveListeningPage createAudio={() => fake as unknown as AudioLike} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** 逐字母填入某空答案 */
async function typeAnswer(user: ReturnType<typeof userEvent.setup>, blankIndex: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    await user.type(screen.getByTestId(`letter-${blankIndex}-${i}`), text[i])
  }
}

describe('听力训练页 — 初始渲染', () => {
  beforeEach(() => localStorage.clear())

  test('无处理产物显示空态', () => {
    seedArticle(false)
    renderPage(createFakeAudio())
    expect(screen.getByTestId('listening-empty')).toHaveTextContent('暂无听力训练数据')
  })

  test('顶栏进度 1/3，统计卡初始值，难度默认「重要词语」', () => {
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('1 / 3')
    expect(screen.getByTestId('stat-accuracy')).toHaveTextContent('正确率 --')
    expect(screen.getByTestId('stat-streak')).toHaveTextContent('连续 0句')
    expect(screen.getByText('第 1 句')).toBeInTheDocument()
    const active = screen.getByTestId('difficulty-pills').querySelector('[aria-pressed="true"]')
    expect(active).toHaveTextContent('重要词语')
  })

  test('数据驱动挖空：重要词语 = 生词 + 短语词元，框数 = 答案长度', () => {
    seedArticle()
    renderPage(createFakeAudio())

    // 第一句生词：procrastination(15) / anxiety(7)
    expect(screen.getAllByTestId(/^letter-0-/)).toHaveLength(15)
    expect(screen.getAllByTestId(/^letter-1-/)).toHaveLength(7)
    const blank = screen.getByText('is not laziness, but the', { exact: false })
    expect(blank).toBeInTheDocument()
  })

  test('无命中生词的句子显示提示且提交禁用', () => {
    seedArticle()
    // 第三句无生词/短语词元：切到第三句
    renderPage(createFakeAudio())
    fireEvent.click(screen.getByTestId('next-sentence'))
    fireEvent.click(screen.getByTestId('next-sentence'))
    expect(screen.getByTestId('dictation-empty')).toBeInTheDocument()
    expect(screen.getByTestId('submit-answer')).toBeDisabled()
  })
})

describe('听力训练页 — 难度切换', () => {
  beforeEach(() => localStorage.clear())

  test('全部听写：所有词元挖空', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('全部听写'))
    // 第一句 14 个词元全部挖空（可见文本只剩标点分隔符）
    const blanks = document.querySelectorAll('.word-blank')
    expect(blanks).toHaveLength(14)
    expect(screen.getByTestId('dictation-text').textContent?.endsWith('.')).toBe(true)
  })

  test('仅生词：只挖生词；切换后输入重置', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('仅生词'))
    expect(screen.getAllByTestId(/^letter-0-/)).toHaveLength(15)
    expect(screen.getAllByTestId(/^letter-1-/)).toHaveLength(7)

    // 切到全部听写再切回，输入区重置（提交可用）
    await user.click(screen.getByText('全部听写'))
    await user.type(screen.getByTestId('letter-0-0'), 'T')
    await user.click(screen.getByText('仅生词'))
    expect(screen.getByTestId('letter-0-0')).toHaveValue('')
    expect(screen.getByTestId('submit-answer')).toBeEnabled()
  })
})

describe('听力训练页 — 逐字母输入', () => {
  beforeEach(() => localStorage.clear())

  test('输入自动前进到下一格', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.type(screen.getByTestId('letter-0-0'), 'p')
    expect(screen.getByTestId('letter-0-1')).toHaveFocus()
  })

  test('退格在空格时回退到上一格', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.type(screen.getByTestId('letter-0-0'), 'p')
    expect(screen.getByTestId('letter-0-1')).toHaveFocus()
    // 第 2 格为空时按退格 → 焦点回退到第 1 格
    await user.type(screen.getByTestId('letter-0-1'), '{backspace}')
    expect(screen.getByTestId('letter-0-0')).toHaveFocus()
  })
})

describe('听力训练页 — 提交判分', () => {
  beforeEach(() => localStorage.clear())

  test('全对：反馈 + 统计更新（正确率 100%，连续 1 句）', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await typeAnswer(user, 0, 'procrastination')
    await typeAnswer(user, 1, 'ANXIETY') // 大小写容错
    await user.click(screen.getByTestId('submit-answer'))

    expect(screen.getByTestId('feedback-title')).toHaveTextContent('完美！')
    expect(screen.getByTestId('feedback-summary')).toHaveTextContent('2 / 2 空格正确')
    expect(screen.getByTestId('stat-accuracy')).toHaveTextContent('正确率 100%')
    expect(screen.getByTestId('stat-streak')).toHaveTextContent('连续 1句')
    expect(screen.getByTestId('feedback-blank-0')).toHaveAttribute('data-correct', 'true')
    expect(screen.getByTestId('feedback-blank-1')).toHaveAttribute('data-correct', 'true')
    // 完整正确句展示
    expect(screen.getByTestId('correct-sentence')).toHaveTextContent(
      'The result of procrastination is not laziness, but the anxiety that builds over time.',
    )
    // 提交后不可重复提交
    expect(screen.getByTestId('submit-answer')).toBeDisabled()
  })

  test('错误空：划线错误输入 → 正确答案，连续清零', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await typeAnswer(user, 0, 'procrastinasion')
    await typeAnswer(user, 1, 'anxiety')
    await user.click(screen.getByTestId('submit-answer'))

    expect(screen.getByTestId('feedback-title')).toHaveTextContent('再接再厉！')
    expect(screen.getByTestId('feedback-summary')).toHaveTextContent('1 / 2 空格正确')
    expect(screen.getByTestId('feedback-blank-0')).toHaveAttribute('data-correct', 'false')
    expect(screen.getByTestId('feedback-blank-0')).toHaveTextContent('procrastinasion')
    expect(screen.getByTestId('feedback-blank-0')).toHaveTextContent('procrastination')
    expect(screen.getByTestId('stat-streak')).toHaveTextContent('连续 0句')
    expect(screen.getByTestId('stat-accuracy')).toHaveTextContent('正确率 50%')
  })

  test('空输入判错并展示「未填」', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByTestId('submit-answer'))
    expect(screen.getByTestId('feedback-blank-0')).toHaveTextContent('（未填）')
    expect(screen.getByTestId('feedback-blank-0')).toHaveTextContent('procrastination')
  })
})

describe('听力训练页 — 导航与译文', () => {
  beforeEach(() => localStorage.clear())

  test('下一句/上一句导航，进度与句卡更新，输入重置', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.type(screen.getByTestId('letter-0-0'), 'p')
    await user.click(screen.getByTestId('next-sentence'))
    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('2 / 3')
    expect(screen.getByText('第 2 句')).toBeInTheDocument()
    // 短语词元挖空：pull(4) / an(2) / all-nighter(11)
    expect(screen.getAllByTestId(/^letter-0-/)).toHaveLength(4)
    expect(screen.getAllByTestId(/^letter-1-/)).toHaveLength(2)
    expect(screen.getAllByTestId(/^letter-2-/)).toHaveLength(11)
    // 输入已重置
    expect(screen.getByTestId('letter-0-0')).toHaveValue('')

    await user.click(screen.getByTestId('prev-sentence'))
    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('1 / 3')
    // 边界禁用
    expect(screen.getByTestId('prev-sentence')).toBeDisabled()
  })

  test('末句时下一句禁用', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())
    await user.click(screen.getByTestId('next-sentence'))
    await user.click(screen.getByTestId('next-sentence'))
    expect(screen.getByTestId('next-sentence')).toBeDisabled()
  })

  test('显示译文可展开/收起', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    expect(screen.queryByTestId('translation-text')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('translation-toggle'))
    expect(screen.getByTestId('translation-text')).toHaveTextContent('拖延的结果不是懒惰，而是随时间累积的焦虑。')
    expect(screen.getByTestId('translation-toggle')).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByTestId('translation-toggle'))
    expect(screen.queryByTestId('translation-text')).not.toBeInTheDocument()
  })
})

describe('听力训练页 — 播放与 Tab', () => {
  beforeEach(() => localStorage.clear())

  test('播放当前句：定位到句首并进入播放态', async () => {
    const user = userEvent.setup()
    const fake = createFakeAudio()
    seedArticle()
    renderPage(fake)

    await user.click(screen.getByTestId('play-sentence'))
    expect(fake.currentTime).toBe(0)

    await user.click(screen.getByTestId('next-sentence'))
    await user.click(screen.getByTestId('play-original'))
    expect(fake.currentTime).toBe(12)
  })

  test('听力挑战 Tab 为占位', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage(createFakeAudio())

    await user.click(screen.getByText('听力挑战'))
    expect(screen.getByTestId('quiz-placeholder')).toBeInTheDocument()
    expect(screen.queryByTestId('sentence-card')).not.toBeInTheDocument()
  })
})
