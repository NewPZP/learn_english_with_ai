import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { App } from '../App'
import { ImportArticlePage } from './ImportArticlePage'
import { ArticleListPage } from './ArticleListPage'
import { defaultTextConfig, defaultVoiceConfig } from '../lib/aiConfig'
import { MockTextAdapter, MockVoiceAdapter } from '../lib/ai/mockAdapters'
import type { PipelineAdapters } from '../lib/processing/pipeline'
import { dateKey } from '../lib/studyProgress'

function renderAtRoute(route: string) {
  window.history.replaceState({}, '', route)
  return render(<App />)
}

/**
 * 工单「文章导入与文章列表」验收测试
 */
describe('导入页', () => {
  beforeEach(() => localStorage.clear())

  test('粘贴文本实时显示字符计数（0/50000）', async () => {
    render(
      <BrowserRouter>
        <ImportArticlePage />
      </BrowserRouter>,
    )

    expect(screen.getByTestId('char-count')).toHaveTextContent('0 / 50000 字符')

    fireEvent.change(screen.getByLabelText('粘贴文章内容'), {
      target: { value: 'hello world' },
    })
    expect(screen.getByTestId('char-count')).toHaveTextContent('11 / 50000 字符')
  })

  test('空内容时「完成导入」禁用', () => {
    render(
      <BrowserRouter>
        <ImportArticlePage />
      </BrowserRouter>,
    )
    expect(screen.getByRole('button', { name: /完成导入/ })).toBeDisabled()
  })

  test('上传 .txt 文件内容填入输入区', async () => {
    const user = userEvent.setup()
    render(
      <BrowserRouter>
        <ImportArticlePage />
      </BrowserRouter>,
    )

    const file = new File(['file content here'], 'article.txt', { type: 'text/plain' })
    const input = screen.getByLabelText('选择 .txt 文件')
    await user.upload(input, file)

    // FileReader 异步读入，等待值生效
    const textarea = screen.getByLabelText('粘贴文章内容')
    await waitFor(() => expect(textarea).toHaveValue('file content here'))
  })
})

describe('导入 → 列表完整流程', () => {
  beforeEach(() => localStorage.clear())

  test('粘贴文本 → 完成导入 → 三步流转完成 → 预览可见 → 回列表见新卡片', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    // 空态可见
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('已导入 0 篇')).toBeInTheDocument()

    // 进入导入页
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    expect(screen.getByRole('heading', { name: '导入文章' }))

    // 粘贴文本并提交
    const textarea = screen.getByLabelText('粘贴文章内容')
    await user.type(textarea, 'The quick brown fox jumps over the lazy dog.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))

    // AI 处理面板出现，三步依次流转完成（结果计数）
    expect(screen.getByTestId('ai-processing-panel')).toBeInTheDocument()
    expect(await screen.findByText('已提取 32 个单词')).toBeInTheDocument()
    expect(screen.getByText('已提取 8 个短语')).toBeInTheDocument()
    expect(await screen.findByText(/语音已生成（约 \d+ 秒）/)).toBeInTheDocument()

    // 生词 chip（单词 + 音标 + 中文释义）与短语（原文 + 释义）预览可见
    expect(screen.getByTestId('word-preview')).toBeInTheDocument()
    expect(screen.getByText('procrastination')).toBeInTheDocument()
    expect(screen.getByText('/prəˌkræstɪˈneɪʃən/')).toBeInTheDocument()
    expect(screen.getByText('拖延症')).toBeInTheDocument()
    expect(screen.getByTestId('phrase-preview')).toBeInTheDocument()
    expect(screen.getByText('instant gratification')).toBeInTheDocument()
    expect(screen.getByText('即时满足')).toBeInTheDocument()

    // 处理产物持久化并与文章关联（含整篇语音音源，供播客/精听消费）
    const stored = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].processing.words).toHaveLength(32)
    expect(stored[0].processing.phrases).toHaveLength(8)
    expect(stored[0].processing.sentences.length).toBeGreaterThanOrEqual(5)
    expect(stored[0].processing.audio.audioUrl).toMatch(/^data:audio\/wav;base64,/)
    expect(stored[0].processing.audio.durationMs).toBeGreaterThan(0)

    // 经侧边栏返回列表，新卡片出现（卡片标题为首句推导）
    await user.click(screen.getByRole('link', { name: '文章' }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    expect(screen.getByText('The quick brown fox jumps over the lazy dog')).toBeInTheDocument()
  })

  test('文章列表持久化，刷新不丢失', () => {
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'Persisted article content.',
          source: '粘贴文本',
          content: 'Persisted article content.',
          wordCount: 3,
          difficulty: 'Beginner',
          createdAt: '2026-09-03',
        },
      ]),
    )

    render(
      <BrowserRouter>
        <ArticleListPage />
      </BrowserRouter>,
    )
    expect(screen.getByText('已导入 1 篇')).toBeInTheDocument()
    expect(screen.getByText('Persisted article content.')).toBeInTheDocument()
  })
})

describe('文章卡片', () => {
  beforeEach(() => localStorage.clear())

  test('显示标题/来源/字数/难度徽章/日期 + 三模式入口锚点', () => {
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'Test Article Title',
          source: 'Tim Urban · TED Talk',
          content: 'some content',
          wordCount: 1250,
          difficulty: 'Intermediate',
          createdAt: '2026-08-10',
        },
      ]),
    )

    render(
      <BrowserRouter>
        <ArticleListPage />
      </BrowserRouter>,
    )

    expect(screen.getByText('Test Article Title')).toBeInTheDocument()
    expect(screen.getByText('Tim Urban · TED Talk')).toBeInTheDocument()
    expect(screen.getByText('1,250 words · Intermediate · 2026-08-10')).toBeInTheDocument()
    expect(screen.getByText('Intermediate')).toBeInTheDocument()

    // data-dom-id 锚点位于卡片内
    expect(document.querySelector('[data-dom-id="cta-word-preview"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-podcast"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-intensive-listening"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-delete-article"]')).toBeInTheDocument()
  })

  test('点击删除按钮并确认后，文章从列表消失', () => {
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'Article One',
          source: 's',
          content: 'c',
          wordCount: 1,
          difficulty: 'Beginner',
          createdAt: '2026-08-10',
        },
        {
          id: 'a2',
          title: 'Article Two',
          source: 's',
          content: 'c',
          wordCount: 1,
          difficulty: 'Beginner',
          createdAt: '2026-08-11',
        },
      ]),
    )

    // 模拟用户点击确认
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <BrowserRouter>
        <ArticleListPage />
      </BrowserRouter>,
    )

    expect(screen.getByText('已导入 2 篇')).toBeInTheDocument()
    expect(screen.getByText('Article One')).toBeInTheDocument()

    // 点击第一张卡片的删除按钮
    fireEvent.click(screen.getAllByText('删除')[0])

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByText('已导入 1 篇')).toBeInTheDocument()
    expect(screen.queryByText('Article One')).not.toBeInTheDocument()
    expect(screen.getByText('Article Two')).toBeInTheDocument()

    // localStorage 中也确实删除了
    const stored = JSON.parse(localStorage.getItem('linguaai.articles') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe('a2')

    vi.restoreAllMocks()
  })

  test('取消删除确认时文章不受影响', () => {
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'Keep Me',
          source: 's',
          content: 'c',
          wordCount: 1,
          difficulty: 'Beginner',
          createdAt: '2026-08-10',
        },
      ]),
    )

    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <BrowserRouter>
        <ArticleListPage />
      </BrowserRouter>,
    )

    fireEvent.click(screen.getByText('删除'))

    expect(screen.getByText('已导入 1 篇')).toBeInTheDocument()
    expect(screen.getByText('Keep Me')).toBeInTheDocument()

    vi.restoreAllMocks()
  })

  test('三模式入口导航到对应路由', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'T',
          source: 's',
          content: 'c',
          wordCount: 1,
          difficulty: 'Beginner',
          createdAt: '2026-08-10',
        },
      ]),
    )

    renderAtRoute('/articles')

    await user.click(screen.getByRole('link', { name: /单词预习/ }))
    expect(screen.getByRole('heading', { name: '单词预习' })).toBeInTheDocument()
    // 无处理产物 → 空态（骨架页已被真实页面替换）
    expect(screen.getByTestId('word-preview-empty')).toBeInTheDocument()

    // 通过侧边栏返回文章列表，再验证播客入口
    await user.click(screen.getByRole('link', { name: '文章' }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '播客' }))
    expect(screen.getByRole('heading', { name: '播客模式' })).toBeInTheDocument()
  })
})

describe('导入 AI 处理管道（页面级）', () => {
  beforeEach(() => localStorage.clear())

  test('未导入时右侧显示占位提示，无处理面板', () => {
    render(
      <BrowserRouter>
        <ImportArticlePage />
      </BrowserRouter>,
    )
    expect(screen.queryByTestId('ai-processing-panel')).not.toBeInTheDocument()
    expect(screen.getByText(/AI 将自动提取生词、短语并生成语音/)).toBeInTheDocument()
  })

  test('处理进行中「完成导入」禁用，防止重复导入', async () => {
    const user = userEvent.setup()
    render(
      <BrowserRouter>
        <ImportArticlePage />
      </BrowserRouter>,
    )
    await user.type(screen.getByLabelText('粘贴文章内容'), 'Some English content here.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))

    expect(await screen.findByText('已提取 32 个单词')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /已导入/ })).toBeDisabled()
  })

  test('单步失败展示错误态与重试入口，重试后完成并持久化产物', async () => {
    const user = userEvent.setup()
    // 接缝：注入首调失败、重试成功的适配器
    const text = new MockTextAdapter(defaultTextConfig)
    const voice = new MockVoiceAdapter(defaultVoiceConfig)
    const extractPhrases = text.extractPhrases.bind(text)
    let phraseCalls = 0
    text.extractPhrases = async (content) => {
      phraseCalls += 1
      if (phraseCalls === 1) throw new Error('短语服务超时')
      return extractPhrases(content)
    }
    const adapters: PipelineAdapters = { text, voice }

    render(
      <BrowserRouter>
        <ImportArticlePage adapters={adapters} />
      </BrowserRouter>,
    )

    await user.type(screen.getByLabelText('粘贴文章内容'), 'Some English content here.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))

    // 第一步完成、第二步失败：错误消息 + 重试按钮可见，第三步保持待处理
    expect(await screen.findByTestId('step-phrases-error')).toHaveTextContent('短语服务超时')
    expect(screen.getByText('已提取 32 个单词')).toBeInTheDocument()
    expect(screen.getByTestId('retry-phrases')).toBeInTheDocument()
    expect(screen.getByTestId('step-audio')).toHaveTextContent('待处理')
    // 失败时无短语预览，产物未持久化
    expect(screen.queryByTestId('phrase-preview')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')[0].processing).toBeUndefined()

    // 重试该步：从失败步骤续跑直至完成
    await user.click(screen.getByTestId('retry-phrases'))
    expect(await screen.findByText('已提取 8 个短语')).toBeInTheDocument()
    expect(await screen.findByText(/语音已生成（约 \d+ 秒）/)).toBeInTheDocument()
    expect(screen.getByTestId('phrase-preview')).toBeInTheDocument()

    // 完成后产物持久化关联到文章
    const stored = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored[0].processing.words).toHaveLength(32)
    expect(stored[0].processing.phrases).toHaveLength(8)
  })
})

describe('导入 → 单词预习完整链路', () => {
  beforeEach(() => localStorage.clear())

  test('E2E：导入并处理 → 卡片进入单词预习 → 翻卡 → 自评 → 进度与复习计划持久化', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'The quick brown fox jumps.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))
    expect(await screen.findByText(/语音已生成（约 \d+ 秒）/)).toBeInTheDocument()

    // 回列表，从卡片进入单词预习
    await user.click(screen.getByRole('link', { name: '文章' }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /单词预习/ }))

    // 32 个处理产物词全部进入预习
    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('0 / 32')
    await user.click(screen.getByTestId('flashcard'))
    expect(screen.getByTestId('flashcard-back')).toBeInTheDocument()

    // 翻面后自评，进度推进、列表状态变化、复习计划持久化
    await user.click(screen.getByTestId('rate-known'))
    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('1 / 32')
    expect(screen.getByTestId('word-row-procrastination')).toHaveAttribute('data-state', 'completed')
    expect(screen.getByTestId('word-row-procrastination')).toHaveTextContent('procrastination')
    const store = JSON.parse(localStorage.getItem('linguaai.word_progress') ?? '{}')
    const articleId = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')[0].id
    expect(Object.values(store[articleId])).toHaveLength(1)
    expect(Object.values(store[articleId])[0]).toMatchObject({ rating: 'known', stage: 1 })
  })

  test('E2E：导入并处理 → 卡片进入播客 → 播放/倍速/点句操作', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    // 导入并等待处理完成（音源 + 时间轴已持久化）
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'The quick brown fox jumps.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))
    expect(await screen.findByText(/语音已生成（约 \d+ 秒）/)).toBeInTheDocument()

    // 回列表进入播客模式
    await user.click(screen.getByRole('link', { name: '文章' }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /播客/ }))

    // 信息卡与字幕区渲染，句子列表与字幕同步高亮首句
    expect(screen.getByTestId('podcast-info-card')).toBeInTheDocument()
    expect(screen.getByTestId('subtitle-area')).toBeInTheDocument()
    expect(screen.getByTestId('sentence-list')).toBeInTheDocument()
    expect(screen.getByTestId('subtitle-line-0').className).toContain('current')

    // 播放/暂停切换（jsdom 下媒体播放不可用，状态乐观推进）
    await user.click(screen.getByTestId('play-pause'))
    expect(screen.getByTestId('play-pause')).toHaveAttribute('aria-label', '暂停')
    await user.click(screen.getByTestId('play-pause'))
    expect(screen.getByTestId('play-pause')).toHaveAttribute('aria-label', '播放')

    // 倍速循环与点句跳听
    await user.click(screen.getByTestId('speed-button'))
    expect(screen.getByTestId('speed-button')).toHaveTextContent('1.5x')
    await user.click(screen.getByTestId('sentence-row-1'))
    expect(screen.getByTestId('subtitle-line-1').className).toContain('current')

    // 句子列表折叠
    await user.click(screen.getByTestId('sentence-list-toggle'))
    expect(screen.queryByTestId('sentence-list')).not.toBeInTheDocument()
  })

  test('E2E：导入并处理 → 卡片进入听力训练 → 切换难度 → 逐字母输入 → 提交 → 判分反馈 → 下一句', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    // 导入并等待处理完成（分句 + 生词/短语 + 音源已持久化）
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'The quick brown fox jumps.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))
    expect(await screen.findByText(/语音已生成（约 \d+ 秒）/)).toBeInTheDocument()

    // 回列表进入听力训练
    await user.click(screen.getByRole('link', { name: '文章' }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /听力训练/ }))

    // 默认难度「重要词语」：首句无命中词语 → 空态提示 + 提交禁用
    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('1 / 5')
    expect(screen.getByTestId('dictation-empty')).toBeInTheDocument()
    expect(screen.getByTestId('submit-answer')).toBeDisabled()

    // 切换难度「全部听写」：首句 11 个词元全部挖空
    await user.click(screen.getByText('全部听写'))
    expect(document.querySelectorAll('.word-blank')).toHaveLength(11)

    // 逐字母输入首词 So（大写容错）并提交
    await user.type(screen.getByTestId('letter-0-0'), 's')
    await user.type(screen.getByTestId('letter-0-1'), 'O')
    await user.click(screen.getByTestId('submit-answer'))
    expect(screen.getByTestId('feedback-summary')).toHaveTextContent('1 / 11 空格正确')
    expect(screen.getByTestId('stat-accuracy')).toHaveTextContent('正确率 9%')
    expect(screen.getByTestId('stat-streak')).toHaveTextContent('连续 0句')
    expect(screen.getByTestId('feedback-blank-0')).toHaveAttribute('data-correct', 'true')
    // 未填空展示「未填」与正确答案
    expect(screen.getByTestId('feedback-blank-1')).toHaveTextContent('（未填）')

    // 下一句 + 切换「仅生词」：第二句仅 thesis 挖空（数据驱动）
    await user.click(screen.getByTestId('next-sentence'))
    expect(screen.getByTestId('topbar-progress')).toHaveTextContent('2 / 5')
    await user.click(screen.getByText('仅生词'))
    expect(document.querySelectorAll('.word-blank')).toHaveLength(1)
    expect(screen.getByTestId('letter-0-0')).toBeInTheDocument()

    // 显示译文展开
    await user.click(screen.getByTestId('translation-toggle'))
    expect(screen.getByTestId('translation-text')).toHaveTextContent('他当时是大四学生，正在写毕业论文。')

    // 输入 thesis 全对 → 完美反馈 + 连续答对
    for (let i = 0; i < 'thesis'.length; i++) {
      await user.type(screen.getByTestId(`letter-0-${i}`), 'thesis'[i])
    }
    await user.click(screen.getByTestId('submit-answer'))
    expect(screen.getByTestId('feedback-title')).toHaveTextContent('完美！')
    expect(screen.getByTestId('feedback-summary')).toHaveTextContent('1 / 1 空格正确')
    expect(screen.getByTestId('stat-streak')).toHaveTextContent('连续 1句')
  })

  test('E2E：导入并处理 → 听力挑战 → 作答三题型 → 提交判分 → 刷新题库轮换', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    // 导入并等待处理完成
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'The quick brown fox jumps.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))
    expect(await screen.findByText(/语音已生成（约 \d+ 秒）/)).toBeInTheDocument()

    // 进入听力训练，切到听力挑战 Tab
    await user.click(screen.getByRole('link', { name: '文章' }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /听力训练/ }))
    await user.click(screen.getByText('听力挑战'))

    // AI 出题徽章 + 三题型渲染
    expect(await screen.findByTestId('quiz-badge')).toHaveTextContent('AI 智能出题')
    expect(screen.getByTestId('quiz-count')).toHaveTextContent('共 3 题')
    expect(screen.getByText('文章作者认为拖延的核心原因是什么？')).toBeInTheDocument()

    // 未答完阻止提交
    expect(screen.getByTestId('submit-quiz')).toBeDisabled()
    expect(screen.getByTestId('unanswered-hint')).toHaveTextContent('3 题未作答')

    // 作答：单选正确 B、填空错误（大小写容错下 'hard work' 判错）、判断答对（错误）
    await user.click(screen.getByTestId('quiz-option-0-1'))
    await user.type(screen.getByTestId('quiz-fill-1'), 'hard work')
    await user.click(screen.getByTestId('quiz-tf-2-false'))
    await user.click(screen.getByTestId('submit-quiz'))

    // 整卷判分：单选对 + 填空错 + 判断对 = 2/3，错题划线作答 → 正确答案
    expect(screen.getByTestId('quiz-score')).toHaveTextContent('2 / 3 正确')
    expect(screen.getByTestId('quiz-comment')).toHaveTextContent('再接再厉！')
    expect(screen.getByTestId('quiz-feedback-0')).toHaveAttribute('data-correct', 'true')
    expect(screen.getByTestId('quiz-feedback-1')).toHaveAttribute('data-correct', 'false')
    expect(screen.getByTestId('quiz-feedback-2')).toHaveAttribute('data-correct', 'true')
    expect(screen.getByTestId('quiz-feedback-1')).toHaveTextContent('hard work')
    expect(screen.getByTestId('quiz-feedback-1')).toHaveTextContent('easy and fun')

    // 刷新题库：轮换到第二套题组，作答与判分重置
    await user.click(screen.getByTestId('refresh-quiz'))
    expect(await screen.findByText('Panic Monster 在大脑里扮演什么角色？')).toBeInTheDocument()
    expect(screen.getByTestId('quiz-fill-1')).toHaveValue('')
    expect(screen.queryByTestId('quiz-feedback')).not.toBeInTheDocument()
    expect(screen.getByTestId('submit-quiz')).toBeDisabled()

    // 新题组全对提交（单选 B、填空 Panic Monster、判断答「错误」）
    await user.click(screen.getByTestId('quiz-option-0-1'))
    await user.type(screen.getByTestId('quiz-fill-1'), 'panic monster')
    await user.click(screen.getByTestId('quiz-tf-2-false'))
    await user.click(screen.getByTestId('submit-quiz'))
    expect(screen.getByTestId('quiz-score')).toHaveTextContent('3 / 3 正确')
    expect(screen.getByTestId('quiz-comment')).toHaveTextContent('完美！')
  })
})

describe('学习进度闭环（工单 #11）', () => {
  beforeEach(() => localStorage.clear())

  /** 种子文章：3 词 + 2 句（时间轴 0-10s）+ 音源，驱动三模式学习行为 */
  function seedProcessedArticle() {
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'Progress Article',
          source: '粘贴文本',
          content: 'The quick brown fox jumps. Then it rests.',
          wordCount: 8,
          difficulty: 'Beginner',
          createdAt: '2026-09-03',
          processing: {
            words: [
              {
                word: 'procrastination',
                phonetic: '/prəˌkræstɪˈneɪʃən/',
                partOfSpeech: 'n.',
                definition: 'Delaying tasks',
                translation: '拖延症',
                example: 'Procrastination is bad.',
                synonyms: ['delay'],
              },
              {
                word: 'rational',
                phonetic: '/ˈræʃənl/',
                partOfSpeech: 'adj.',
                definition: 'Based on reason',
                translation: '理性的',
                example: 'A rational choice.',
                synonyms: ['logical'],
              },
              {
                word: 'deadline',
                phonetic: '/ˈdedlaɪn/',
                partOfSpeech: 'n.',
                definition: 'The latest time',
                translation: '截止日期',
                example: 'The deadline is near.',
                synonyms: ['due date'],
              },
            ],
            phrases: [],
            sentences: [
              { text: 'The quick brown fox jumps.', startMs: 0, endMs: 5000 },
              { text: 'Then it rests.', startMs: 5000, endMs: 10000 },
            ],
            audio: { audioUrl: 'mock://a1.wav', mimeType: 'audio/wav', durationMs: 10000 },
          },
        },
      ]),
    )
  }

  test('E2E：完成预习/播客/精听行为 → 返回列表 → 卡片进度正确回显', async () => {
    const user = userEvent.setup()
    seedProcessedArticle()
    renderAtRoute('/articles')

    // 初始卡片进度全 0
    expect(screen.getByTestId('card-progress-words')).toHaveTextContent('0/3')
    expect(screen.getByTestId('card-progress-podcast')).toHaveTextContent('0%')
    expect(screen.getByTestId('card-progress-listening')).toHaveTextContent('0/2')

    // 1) 单词预习：自评首词「认识」→ 1/3
    await user.click(screen.getByRole('link', { name: /单词预习/ }))
    await user.click(screen.getByTestId('rate-known'))
    await user.click(screen.getByRole('link', { name: '返回文章列表' }))

    // 2) 播客：拖动进度条到 5s/10s → 50%
    await user.click(screen.getByRole('link', { name: /播客/ }))
    fireEvent.change(screen.getByTestId('progress-slider'), { target: { value: '5000' } })
    await user.click(screen.getByRole('link', { name: '返回文章列表' }))

    // 3) 听力训练：提交首句作答 → 1/2
    await user.click(screen.getByRole('link', { name: /听力训练/ }))
    await user.click(screen.getByText('全部听写'))
    await user.type(screen.getByTestId('letter-0-0'), 't')
    await user.click(screen.getByTestId('submit-answer'))
    await user.click(screen.getByRole('link', { name: '返回文章列表' }))

    // 返回列表：三模式进度回显真实数据，进度条填充与数值一致
    expect(await screen.findByTestId('card-progress-words')).toHaveTextContent('1/3')
    expect(screen.getByTestId('card-progress-words-fill')).toHaveStyle({ width: '33%' })
    expect(screen.getByTestId('card-progress-podcast')).toHaveTextContent('50%')
    expect(screen.getByTestId('card-progress-podcast-fill')).toHaveStyle({ width: '50%' })
    expect(screen.getByTestId('card-progress-listening')).toHaveTextContent('1/2')
    expect(screen.getByTestId('card-progress-listening-fill')).toHaveStyle({ width: '50%' })
  })

  test('今日学习分钟数按当天累计显示，跨天归零', () => {
    localStorage.setItem('linguaai.articles', '[]')

    // 当日累计 5 分钟
    localStorage.setItem(
      'linguaai.study_time',
      JSON.stringify({ date: dateKey(), ms: 5 * 60_000 }),
    )
    const { unmount } = render(
      <BrowserRouter>
        <ArticleListPage />
      </BrowserRouter>,
    )
    expect(screen.getByTestId('today-study-minutes')).toHaveTextContent('今日学习 5 分钟')

    // 存储日期非今日（跨天）→ 归零
    unmount()
    localStorage.setItem(
      'linguaai.study_time',
      JSON.stringify({ date: '2000-01-01', ms: 5 * 60_000 }),
    )
    render(
      <BrowserRouter>
        <ArticleListPage />
      </BrowserRouter>,
    )
    expect(screen.getByTestId('today-study-minutes')).toHaveTextContent('今日学习 0 分钟')
  })
})
