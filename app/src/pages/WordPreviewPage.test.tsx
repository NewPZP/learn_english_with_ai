import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App'

/**
 * 工单「单词预习模式」验收测试
 * 覆盖：翻卡、三档自评推进、记忆曲线三态、单词列表状态、进度统计、完成态、持久化
 */

const WORDS = [
  {
    word: 'procrastination',
    phonetic: '/prəˌkræstɪˈneɪʃən/',
    partOfSpeech: 'n.',
    definition: 'The act of delaying tasks',
    translation: '拖延症',
    example: 'His procrastination led to panic.',
    synonyms: ['delay'],
  },
  {
    word: 'rational',
    phonetic: '/ˈræʃənl/',
    partOfSpeech: 'adj.',
    definition: 'Based on reason',
    translation: '理性的',
    example: 'The rational decision-maker plans.',
    synonyms: ['logical'],
  },
  {
    word: 'deadline',
    phonetic: '/ˈdedlaɪn/',
    partOfSpeech: 'n.',
    definition: 'The latest time to finish',
    translation: '截止日期',
    example: 'The deadline is near.',
    synonyms: ['due date'],
  },
]

function seedArticle(withProcessing = true) {
  localStorage.setItem(
    'linguaai.articles',
    JSON.stringify([
      {
        id: 'a1',
        title: 'Procrastination Article',
        source: '粘贴文本',
        content: 'some content',
        wordCount: 2,
        difficulty: 'Intermediate',
        createdAt: '2026-09-03',
        ...(withProcessing ? { processing: { words: WORDS, phrases: [], sentences: [] } } : {}),
      },
    ]),
  )
}

function renderPage() {
  window.history.replaceState({}, '', '/articles/a1/words')
  return render(<App />)
}

describe('单词预习页 — 初始渲染', () => {
  beforeEach(() => localStorage.clear())

  test('无 AI 处理产物的文章显示空态', () => {
    seedArticle(false)
    renderPage()
    expect(screen.getByTestId('word-preview-empty')).toHaveTextContent('暂无可预习的单词')
  })

  test('闪卡正面：单词/音标/词性 + 翻面提示；进度 0/3', () => {
    seedArticle()
    renderPage()

    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('0 / 3')
    expect(screen.getByRole('heading', { name: 'procrastination' })).toBeInTheDocument()
    expect(screen.getByText('/prəˌkræstɪˈneɪʃən/')).toBeInTheDocument()
    expect(screen.getByText('n.')).toBeInTheDocument()
    expect(screen.getByText('点击卡片查看释义')).toBeInTheDocument()
    expect(screen.getByText('已掌握 0 词')).toBeInTheDocument()
    expect(screen.getByText('待复习 0 词')).toBeInTheDocument()
  })

  test('记忆曲线渲染 5 个节点：首节点当前（脉冲），其余待复习', () => {
    seedArticle()
    renderPage()

    for (let i = 0; i < 5; i++) {
      const node = screen.getByTestId(`curve-node-${i}`)
      expect(node).toHaveAttribute('data-status', i === 0 ? 'current' : 'upcoming')
    }
    expect(screen.getByText('1天')).toBeInTheDocument()
    expect(screen.getByText('15天')).toBeInTheDocument()
  })

  test('右栏单词列表：首词当前高亮，其余待学习', () => {
    seedArticle()
    renderPage()

    expect(screen.getByTestId('word-row-procrastination')).toHaveAttribute('data-state', 'current')
    expect(screen.getByTestId('word-row-rational')).toHaveAttribute('data-state', 'upcoming')
    expect(screen.getByTestId('word-row-deadline')).toHaveAttribute('data-state', 'upcoming')
    expect(screen.getByText('3')).toBeInTheDocument() // 总数
  })
})

describe('单词预习页 — 翻卡与自评', () => {
  beforeEach(() => localStorage.clear())

  test('点击闪卡翻面：背面含释义/例句/翻译/近义词；再点回正面', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage()

    await user.click(screen.getByTestId('flashcard'))
    expect(screen.getByTestId('flashcard-back')).toBeInTheDocument()
    expect(screen.getByText('The act of delaying tasks')).toBeInTheDocument()
    expect(screen.getByText('His procrastination led to panic.')).toBeInTheDocument()
    expect(screen.getByText('拖延症')).toBeInTheDocument()
    expect(screen.getByText('Syn: delay')).toBeInTheDocument()

    await user.click(screen.getByTestId('flashcard'))
    expect(screen.getByTestId('flashcard-front')).toBeInTheDocument()
  })

  test('自评「认识」后切下一词：进度/统计/列表状态实时更新并持久化', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage()

    await user.click(screen.getByTestId('rate-known'))

    // 进度 1/3，统计已掌握 1
    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('1 / 3')
    expect(screen.getByText('已掌握 1 词')).toBeInTheDocument()
    // 列表首词已完成 ✓，第二词成为当前
    expect(screen.getByTestId('word-row-procrastination')).toHaveAttribute('data-state', 'completed')
    expect(screen.getByTestId('word-row-rational')).toHaveAttribute('data-state', 'current')
    // 闪卡切到第二词且回到正面
    expect(screen.getByText('/ˈræʃənl/')).toBeInTheDocument()
    expect(screen.getByText('点击卡片查看释义')).toBeInTheDocument()

    // 持久化：记录含自评档位与下次复习时间
    const store = JSON.parse(localStorage.getItem('linguaai.word_progress') ?? '{}')
    expect(store.a1.procrastination).toMatchObject({ rating: 'known', stage: 1 })
    expect(store.a1.procrastination.nextReviewAt).toBeTruthy()
  })

  test('「不认识」计入待复习统计', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage()

    await user.click(screen.getByTestId('rate-unknown'))
    expect(screen.getByText('已掌握 0 词')).toBeInTheDocument()
    expect(screen.getByText('待复习 1 词')).toBeInTheDocument()

    const store = JSON.parse(localStorage.getItem('linguaai.word_progress') ?? '{}')
    expect(store.a1.procrastination).toMatchObject({ rating: 'unknown', stage: 0 })
  })

  test('全部自评后显示完成态，评分按钮消失', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage()

    await user.click(screen.getByTestId('rate-known'))
    await user.click(screen.getByTestId('rate-fuzzy'))
    await user.click(screen.getByTestId('rate-known'))

    expect(screen.getByTestId('completion-card')).toHaveTextContent('全部完成')
    expect(screen.getByTestId('completion-card')).toHaveTextContent('已掌握 2 词')
    expect(screen.getByTestId('completion-card')).toHaveTextContent('待复习 1 词')
    expect(screen.queryByTestId('rate-known')).not.toBeInTheDocument()
    // 曲线全部节点已完成
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`curve-node-${i}`)).toHaveAttribute('data-status', 'completed')
    }
  })

  test('完成态下点击列表词可回到该词闪卡重评', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage()

    await user.click(screen.getByTestId('rate-known'))
    await user.click(screen.getByTestId('rate-known'))
    await user.click(screen.getByTestId('rate-known'))
    expect(screen.getByTestId('completion-card')).toBeInTheDocument()

    await user.click(screen.getByTestId('word-row-deadline'))
    expect(screen.queryByTestId('completion-card')).not.toBeInTheDocument()
    expect(screen.getByText('/ˈdedlaɪn/')).toBeInTheDocument()
    // 重评后完成卡恢复
    await user.click(screen.getByTestId('rate-unknown'))
    expect(screen.getByTestId('completion-card')).toBeInTheDocument()
  })
})

describe('单词预习页 — 进度持久化与续学', () => {
  beforeEach(() => localStorage.clear())

  test('已评单词重新进入页面后保持已完成，进度回显', () => {
    seedArticle()
    localStorage.setItem(
      'linguaai.word_progress',
      JSON.stringify({
        a1: {
          procrastination: {
            word: 'procrastination',
            rating: 'known',
            stage: 2,
            ratedAt: '2026-09-03T10:00:00.000Z',
            nextReviewAt: '2026-09-07T10:00:00.000Z',
          },
        },
      }),
    )
    renderPage()

    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('1 / 3')
    expect(screen.getByText('已掌握 1 词')).toBeInTheDocument()
    expect(screen.getByTestId('word-row-procrastination')).toHaveAttribute('data-state', 'completed')
    // 当前词为首个未评词 rational
    expect(screen.getByTestId('word-row-rational')).toHaveAttribute('data-state', 'current')
    expect(screen.getByText('/ˈræʃənl/')).toBeInTheDocument()
  })
})

describe('单词预习页 — 列表跳转与曲线联动', () => {
  beforeEach(() => localStorage.clear())

  test('点击列表中待学习词可跳转闪卡', async () => {
    const user = userEvent.setup()
    seedArticle()
    renderPage()

    await user.click(screen.getByTestId('word-row-deadline'))
    expect(screen.getByText('/ˈdedlaɪn/')).toBeInTheDocument()
    expect(screen.getByTestId('word-row-deadline')).toHaveAttribute('data-state', 'current')
  })

  test('跳回已评词时记忆曲线按其档位推进（节点 2 当前，节点 1 已完成）', async () => {
    const user = userEvent.setup()
    seedArticle()
    localStorage.setItem(
      'linguaai.word_progress',
      JSON.stringify({
        a1: {
          procrastination: {
            word: 'procrastination',
            rating: 'known',
            stage: 1,
            ratedAt: '2026-09-03T10:00:00.000Z',
            nextReviewAt: '2026-09-05T10:00:00.000Z',
          },
        },
      }),
    )
    renderPage()

    // 默认当前词 rational（未评，档位 0）→ 曲线节点 0 当前
    expect(screen.getByTestId('curve-node-0')).toHaveAttribute('data-status', 'current')

    // 跳回已评词（stage 1）→ 节点 1 当前、节点 0 已完成
    await user.click(screen.getByTestId('word-row-procrastination'))
    expect(screen.getByTestId('curve-node-0')).toHaveAttribute('data-status', 'completed')
    expect(screen.getByTestId('curve-node-1')).toHaveAttribute('data-status', 'current')
    expect(screen.getByTestId('curve-node-2')).toHaveAttribute('data-status', 'upcoming')
  })
})
