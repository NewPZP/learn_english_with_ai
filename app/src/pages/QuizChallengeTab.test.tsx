import { beforeEach, describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuizChallengeTab } from './QuizChallengeTab'
import type { Quiz } from '../lib/ai/types'

/**
 * 工单 #10 验收测试（组件级，注入假出题函数）
 * 覆盖：三题型渲染与作答、未答阻止提交、整卷判分反馈、刷新题库轮换重置
 */

const QUIZ_SET_A: Quiz[] = [
  {
    type: 'single-choice',
    question: '文章作者认为拖延的核心原因是什么？',
    options: ['缺乏时间管理能力', '大脑存在即时满足与长期规划的冲突', '对任务难度的高估', '外界干扰过多'],
    answer: '大脑存在即时满足与长期规划的冲突',
    explanation: '猴子与理性决策者的冲突。',
  },
  {
    type: 'fill-blank',
    question: '根据文章内容填空：The monkey cares only about ______.',
    answer: 'easy and fun',
    explanation: '轻松与有趣。',
  },
  {
    type: 'true-false',
    question: '判断正误：Panic Monster 只在截止日期临近时才会出现。',
    answer: false,
    explanation: '其他可怕后果也会唤醒它。',
  },
]

const QUIZ_SET_B: Quiz[] = [
  {
    type: 'single-choice',
    question: 'Panic Monster 在大脑里扮演什么角色？',
    options: ['帮助制定长期计划', '吓跑即时满足猴子', '提高任务趣味性', '消除截止日期'],
    answer: '吓跑即时满足猴子',
    explanation: '它是猴子唯一害怕的存在。',
  },
  {
    type: 'fill-blank',
    question: '根据文章内容填空：The ______ scares the monkey.',
    answer: 'Panic Monster',
    explanation: '见上文。',
  },
  {
    type: 'true-false',
    question: '判断正误：人人都会拖延。',
    answer: true,
    explanation: '每个人的大脑里都有猴子。',
  },
]

/** 假出题函数：两套轮换，模拟 mock 适配器行为 */
function createFakeGenerateQuiz() {
  const sets = [QUIZ_SET_A, QUIZ_SET_B]
  let cursor = 0
  const fn = vi.fn(async () => {
    const set = sets[cursor % sets.length]
    cursor += 1
    return JSON.parse(JSON.stringify(set)) as Quiz[]
  })
  return fn
}

function renderTab(generate = createFakeGenerateQuiz()) {
  render(<QuizChallengeTab content="article content" generateQuiz={generate} />)
  return generate
}

async function answerAll(user: ReturnType<typeof userEvent.setup>) {
  // Q1 单选：选正确项 B
  await user.click(screen.getByTestId('quiz-option-0-1'))
  // Q2 填空：大小写容错
  await user.type(screen.getByTestId('quiz-fill-1'), 'EASY AND FUN')
  // Q3 判断：答「错误」（正确答案）
  await user.click(screen.getByTestId('quiz-tf-2-false'))
}

describe('QuizChallengeTab — 初始加载与渲染', () => {
  test('加载完成后渲染头部（徽章/题数/刷新）与三题型', async () => {
    renderTab()
    expect(await screen.findByTestId('quiz-header')).toBeInTheDocument()
    expect(screen.getByTestId('quiz-badge')).toHaveTextContent('AI 智能出题')
    expect(screen.getByTestId('quiz-count')).toHaveTextContent('共 3 题')
    expect(screen.getByTestId('refresh-quiz')).toBeInTheDocument()

    // 单选 4 选项 A-D；填空输入；判断两按钮
    expect(screen.getByTestId('quiz-card-0')).toHaveTextContent('文章作者认为拖延的核心原因是什么？')
    for (let j = 0; j < 4; j++) expect(screen.getByTestId(`quiz-option-0-${j}`)).toBeInTheDocument()
    expect(screen.getByTestId('quiz-fill-1')).toBeInTheDocument()
    expect(screen.getByTestId('quiz-tf-2-true')).toHaveTextContent('正确')
    expect(screen.getByTestId('quiz-tf-2-false')).toHaveTextContent('错误')
  })

  test('出题失败显示错误态并可重试', async () => {
    const generate = vi
      .fn<(content: string) => Promise<Quiz[]>>()
      .mockRejectedValueOnce(new Error('出题失败'))
      .mockResolvedValue(QUIZ_SET_A)
    render(<QuizChallengeTab content="c" generateQuiz={generate} />)
    expect(await screen.findByTestId('quiz-error')).toHaveTextContent('出题失败')
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByTestId('quiz-header')).toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(2)
  })

  test('空题组显示空态', async () => {
    render(<QuizChallengeTab content="c" generateQuiz={vi.fn().mockResolvedValue([])} />)
    expect(await screen.findByTestId('quiz-empty')).toBeInTheDocument()
  })
})

describe('QuizChallengeTab — 作答与未答阻止', () => {
  test('单选点击选中，再点切换', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByTestId('quiz-header')

    await user.click(screen.getByTestId('quiz-option-0-0'))
    expect(screen.getByTestId('quiz-option-0-0')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByTestId('quiz-option-0-2'))
    expect(screen.getByTestId('quiz-option-0-2')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('quiz-option-0-0')).toHaveAttribute('aria-pressed', 'false')
  })

  test('未答完时提交禁用并提示剩余题数', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByTestId('quiz-header')

    expect(screen.getByTestId('submit-quiz')).toBeDisabled()
    expect(screen.getByTestId('unanswered-hint')).toHaveTextContent('3 题未作答')

    await user.click(screen.getByTestId('quiz-option-0-1'))
    expect(screen.getByTestId('unanswered-hint')).toHaveTextContent('2 题未作答')
  })
})

describe('QuizChallengeTab — 整卷判分', () => {
  test('全对：3/3 + 完美！，逐题 回答正确 + 解析，提交后锁定', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByTestId('quiz-header')

    await answerAll(user)
    expect(screen.getByTestId('submit-quiz')).toBeEnabled()
    await user.click(screen.getByTestId('submit-quiz'))

    expect(screen.getByTestId('quiz-score')).toHaveTextContent('3 / 3 正确')
    expect(screen.getByTestId('quiz-comment')).toHaveTextContent('完美！')
    for (let i = 0; i < 3; i++) {
      expect(screen.getByTestId(`quiz-feedback-${i}`)).toHaveAttribute('data-correct', 'true')
      expect(screen.getByTestId(`quiz-feedback-${i}`)).toHaveTextContent('回答正确')
    }
    expect(screen.getByTestId('quiz-feedback-0')).toHaveTextContent('猴子与理性决策者的冲突。')
    // 提交后控件锁定且不可重复提交
    expect(screen.getByTestId('submit-quiz')).toBeDisabled()
    expect(screen.getByTestId('quiz-option-0-1')).toBeDisabled()
    expect(screen.getByTestId('quiz-fill-1')).toHaveProperty('readOnly', true)
  })

  test('部分错：总分 1/3 + 划线作答 → 正确答案', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByTestId('quiz-header')

    // Q1 错选 A；Q2 错答 hard work；Q3 对（错误）
    await user.click(screen.getByTestId('quiz-option-0-0'))
    await user.type(screen.getByTestId('quiz-fill-1'), 'hard work')
    await user.click(screen.getByTestId('quiz-tf-2-false'))
    await user.click(screen.getByTestId('submit-quiz'))

    expect(screen.getByTestId('quiz-score')).toHaveTextContent('1 / 3 正确')
    expect(screen.getByTestId('quiz-comment')).toHaveTextContent('再接再厉！')
    expect(screen.getByTestId('quiz-feedback-0')).toHaveAttribute('data-correct', 'false')
    expect(screen.getByTestId('quiz-feedback-0')).toHaveTextContent('缺乏时间管理能力')
    expect(screen.getByTestId('quiz-feedback-0')).toHaveTextContent('大脑存在即时满足与长期规划的冲突')
    // 判断题错误答案展示为 正确/错误 文本
    expect(screen.getByTestId('quiz-feedback-1')).toHaveTextContent('hard work')
    expect(screen.getByTestId('quiz-feedback-1')).toHaveTextContent('easy and fun')
    // 提交后正确选项标绿、错选标红
    expect(screen.getByTestId('quiz-option-0-1').className).toContain('correct')
    expect(screen.getByTestId('quiz-option-0-0').className).toContain('wrong')
  })
})

describe('QuizChallengeTab — 刷新题库', () => {
  test('刷新轮换新题组并重置作答与判分', async () => {
    const user = userEvent.setup()
    const generate = renderTab()
    await screen.findByTestId('quiz-header')

    // 作答并提交
    await answerAll(user)
    await user.click(screen.getByTestId('submit-quiz'))
    expect(screen.getByTestId('quiz-score')).toHaveTextContent('3 / 3 正确')

    // 刷新：新题组 + 作答/判分重置
    await user.click(screen.getByTestId('refresh-quiz'))
    expect(await screen.findByText('Panic Monster 在大脑里扮演什么角色？')).toBeInTheDocument()
    expect(screen.getByTestId('quiz-fill-1')).toHaveValue('')
    expect(screen.queryByTestId('quiz-feedback')).not.toBeInTheDocument()
    expect(screen.getByTestId('submit-quiz')).toBeDisabled()
    expect(screen.getByTestId('unanswered-hint')).toHaveTextContent('3 题未作答')
    expect(generate).toHaveBeenCalledTimes(2)

    // 新题组可正常作答提交（判断题答案为「正确」）
    await user.click(screen.getByTestId('quiz-option-0-1'))
    await user.type(screen.getByTestId('quiz-fill-1'), 'panic monster')
    await user.click(screen.getByTestId('quiz-tf-2-true'))
    await user.click(screen.getByTestId('submit-quiz'))
    expect(screen.getByTestId('quiz-score')).toHaveTextContent('3 / 3 正确')
  })
})

describe('QuizChallengeTab — 题目缓存（减少 token）', () => {
  beforeEach(() => localStorage.clear())

  test('首次生成后缓存，再次进入同一文章直接复用、不再调用出题', async () => {
    const generate = createFakeGenerateQuiz()

    // 首次进入：调用出题并缓存
    const { unmount } = render(
      <QuizChallengeTab articleId="art-1" content="c" generateQuiz={generate} />,
    )
    expect(await screen.findByTestId('quiz-header')).toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(1)
    unmount()

    // 再次进入同一文章：命中缓存，不再调用出题
    const generate2 = createFakeGenerateQuiz()
    render(<QuizChallengeTab articleId="art-1" content="c" generateQuiz={generate2} />)
    expect(await screen.findByTestId('quiz-header')).toBeInTheDocument()
    expect(generate2).not.toHaveBeenCalled()
    // 复用的仍是第一套题
    expect(screen.getByText('文章作者认为拖延的核心原因是什么？')).toBeInTheDocument()
  })

  test('刷新题库清除缓存并重新生成', async () => {
    const user = userEvent.setup()
    const generate = createFakeGenerateQuiz()
    const { unmount } = render(
      <QuizChallengeTab articleId="art-2" content="c" generateQuiz={generate} />,
    )
    expect(await screen.findByTestId('quiz-header')).toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(1)

    // 刷新：清缓存 + 重新出题
    await user.click(screen.getByTestId('refresh-quiz'))
    expect(await screen.findByText('Panic Monster 在大脑里扮演什么角色？')).toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(2)
    unmount()

    // 此时缓存已更新为第二套；再次进入应复用第二套
    const generate3 = createFakeGenerateQuiz()
    render(<QuizChallengeTab articleId="art-2" content="c" generateQuiz={generate3} />)
    expect(await screen.findByText('Panic Monster 在大脑里扮演什么角色？')).toBeInTheDocument()
    expect(generate3).not.toHaveBeenCalled()
  })
})
