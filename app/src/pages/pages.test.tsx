import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
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

type User = ReturnType<typeof userEvent.setup>

/**
 * 经卡片「AI 预处理」进入加工页，依次独立触发三步（提取单词/短语/生成语音），
 * 每步等待完成且按钮恢复可用（running 已清除），再返回列表。
 * 产物经 mergeProcessing 持久化，供后续单词预习/播客/听力训练消费。
 */
async function processViaAiPreprocess(user: User) {
  await user.click(screen.getByRole('link', { name: /AI 预处理/ }))
  await screen.findByTestId('ai-processing-panel')

  await user.click(screen.getByTestId('process-words'))
  await screen.findByText('已提取 32 个单词')
  await waitFor(() => expect(screen.getByTestId('process-words')).toBeEnabled())

  await user.click(screen.getByTestId('process-phrases'))
  await screen.findByText('已提取 8 个短语')
  await waitFor(() => expect(screen.getByTestId('process-phrases')).toBeEnabled())

  await user.click(screen.getByTestId('process-audio'))
  await screen.findByText(/语音已生成（约 \d+ 秒）/)
  await waitFor(() => expect(screen.getByTestId('process-audio')).toBeEnabled())

  await user.click(screen.getByRole('button', { name: /返回列表/ }))
  expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
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

  test('粘贴文本 → 完成导入（只存文本）→ AI 预处理三步独立完成 → 预览可见 → 产物持久化', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    // 空态可见
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('已导入 0 篇')).toBeInTheDocument()

    // 进入导入页
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    expect(screen.getByRole('heading', { name: '导入文章' }))

    // 粘贴文本并完成导入：仅保存纯文本，不触发 AI，保存后回列表
    const textarea = screen.getByLabelText('粘贴文章内容')
    await user.type(textarea, 'The quick brown fox jumps over the lazy dog.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))

    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    // 导入后无 processing（首次只存文本）
    const stored0 = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored0).toHaveLength(1)
    expect(stored0[0].processing).toBeUndefined()

    // 经卡片「AI 预处理」进入加工页，三步初始均为待处理
    await user.click(screen.getByRole('link', { name: /AI 预处理/ }))
    expect(screen.getByRole('heading', { name: 'AI 预处理' })).toBeInTheDocument()
    expect(screen.getByTestId('ai-processing-panel')).toBeInTheDocument()
    expect(screen.getByTestId('step-words')).toHaveTextContent('待处理')
    expect(screen.getByTestId('step-phrases')).toHaveTextContent('待处理')
    expect(screen.getByTestId('step-audio')).toHaveTextContent('待处理')

    // 依次独立触发三步（互不依赖）；每步完成后产物即时持久化（部分合并，保留其它产物）
    await user.click(screen.getByTestId('process-words'))
    expect(await screen.findByText('已提取 32 个单词')).toBeInTheDocument()
    expect(screen.getByTestId('word-preview')).toBeInTheDocument()
    expect(screen.getByText('procrastination')).toBeInTheDocument()
    expect(screen.getByText('拖延症')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('process-words')).toBeEnabled())

    await user.click(screen.getByTestId('process-phrases'))
    expect(await screen.findByText('已提取 8 个短语')).toBeInTheDocument()
    expect(screen.getByTestId('phrase-preview')).toBeInTheDocument()
    expect(screen.getByText('instant gratification')).toBeInTheDocument()
    expect(screen.getByText('即时满足')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('process-phrases')).toBeEnabled())

    await user.click(screen.getByTestId('process-audio'))
    expect(await screen.findByText(/语音已生成（约 \d+ 秒）/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('process-audio')).toBeEnabled())

    // 处理产物部分合并持久化（words/phrases/sentences/audio 齐备）
    const stored = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored[0].processing.words).toHaveLength(32)
    expect(stored[0].processing.phrases).toHaveLength(8)
    expect(stored[0].processing.sentences.length).toBeGreaterThanOrEqual(5)
    expect(stored[0].processing.audio.audioUrl).toMatch(/^data:audio\/wav;base64,/)
    expect(stored[0].processing.audio.durationMs).toBeGreaterThan(0)

    // 返回列表见新卡片（卡片标题为首句推导）
    await user.click(screen.getByRole('button', { name: /返回列表/ }))
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
    expect(document.querySelector('[data-dom-id="cta-ai-process"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-word-preview"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-deep-learning"]')).toBeInTheDocument()
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

    await user.click(screen.getByRole('link', { name: '深入学习' }))
    expect(screen.getByRole('heading', { name: '深入学习' })).toBeInTheDocument()
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
    expect(screen.getByText(/导入后可在文章卡片点/)).toBeInTheDocument()
  })

  test('完成导入即时保存并返回列表，不触发 AI 处理', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'Some English content here.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))

    // 即时回到列表，文章已存入但未加工
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored[0].processing).toBeUndefined()
  })

  test('加工页单步失败展示错误态与重试入口，重试后完成并持久化该步产物', async () => {
    const user = userEvent.setup()
    // 种子文章 a1（无 processing）供加工模式加载
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'Some English content here',
          source: '粘贴文本',
          content: 'Some English content here.',
          wordCount: 4,
          difficulty: 'Beginner',
          createdAt: '2026-09-03',
        },
      ]),
    )
    // 接缝：注入首调失败、重试成功的适配器（仅 phrases 会失败一次）
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
      <MemoryRouter initialEntries={['/articles/a1/process']}>
        <Routes>
          <Route path="/articles/:id/process" element={<ImportArticlePage adapters={adapters} />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('ai-processing-panel')).toBeInTheDocument()

    // 单独触发 phrases：失败 → 错误消息 + 重试入口，words/audio 保持待处理（互不依赖）
    await user.click(screen.getByTestId('process-phrases'))
    expect(await screen.findByTestId('step-phrases-error')).toHaveTextContent('短语服务超时')
    expect(screen.getByTestId('process-phrases')).toHaveTextContent('重试')
    expect(screen.getByTestId('step-words')).toHaveTextContent('待处理')
    expect(screen.getByTestId('step-audio')).toHaveTextContent('待处理')
    // 失败时无短语预览，产物未持久化
    expect(screen.queryByTestId('phrase-preview')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')[0].processing).toBeUndefined()

    // 重试该步：成功后短语产物部分合并持久化（words/audio 仍空，验证单步独立）
    await user.click(screen.getByTestId('process-phrases'))
    expect(await screen.findByText('已提取 8 个短语')).toBeInTheDocument()
    expect(screen.getByTestId('phrase-preview')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('process-phrases')).toBeEnabled())

    const stored = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored[0].processing.phrases).toHaveLength(8)
    expect(stored[0].processing.words).toEqual([])
    expect(stored[0].processing.audio).toBeUndefined()
  })

  test('重提单词覆盖旧词表且不清空已有短语/音频', async () => {
    const user = userEvent.setup()
    // 种子文章 a1：已有 words(3)/phrases(1)/audio，验证重提 words 不扰动其它产物
    localStorage.setItem(
      'linguaai.articles',
      JSON.stringify([
        {
          id: 'a1',
          title: 'Some English content here',
          source: '粘贴文本',
          content: 'Some English content here.',
          wordCount: 4,
          difficulty: 'Beginner',
          createdAt: '2026-09-03',
          processing: {
            words: [{ word: 'old', phonetic: '', partOfSpeech: '', definition: '', translation: '', example: '', synonyms: [] }],
            phrases: [{ phrase: 'keep me', definition: '', translation: '保留', example: '' }],
            sentences: [{ text: 's', startMs: 0, endMs: 1000 }],
            audio: { audioUrl: 'data:audio/wav;base64,old', mimeType: 'audio/wav', durationMs: 1000 },
          },
        },
      ]),
    )

    render(
      <MemoryRouter initialEntries={['/articles/a1/process']}>
        <Routes>
          <Route path="/articles/:id/process" element={<ImportArticlePage />} />
        </Routes>
      </MemoryRouter>,
    )

    // 进入加工页即见已有产物状态（words/phrases/audio 均 done）
    expect(await screen.findByTestId('ai-processing-panel')).toBeInTheDocument()
    expect(screen.getByTestId('step-words')).toHaveTextContent('已提取 1 个单词')
    expect(screen.getByTestId('step-phrases')).toHaveTextContent('已提取 1 个短语')
    expect(screen.getByTestId('step-audio')).toHaveTextContent(/语音已生成/)

    // 重提 words：旧 1 词被覆盖为 mock 的 32 词；phrases(1)/audio 保留
    await user.click(screen.getByTestId('process-words'))
    expect(await screen.findByText('已提取 32 个单词')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('process-words')).toBeEnabled())

    const stored = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored[0].processing.words).toHaveLength(32)
    expect(stored[0].processing.phrases).toHaveLength(1)
    expect(stored[0].processing.audio.audioUrl).toBe('data:audio/wav;base64,old')
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
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    // 经 AI 预处理完成三步加工后回列表
    await processViaAiPreprocess(user)

    // 从卡片进入单词预习
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

    // 导入并经 AI 预处理完成加工（音源 + 时间轴已持久化）
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'The quick brown fox jumps.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    await processViaAiPreprocess(user)

    // 进入深入学习
    await user.click(screen.getByRole('link', { name: /深入学习/ }))

    // 信息卡与字幕区渲染，首句高亮
    expect(screen.getByTestId('podcast-info-card')).toBeInTheDocument()
    expect(screen.getByTestId('subtitle-area')).toBeInTheDocument()
    expect(screen.getByTestId('subtitle-line-0').className).toContain('current')

    // 播放/暂停切换（jsdom 下媒体播放不可用，状态乐观推进）
    await user.click(screen.getByTestId('play-pause'))
    expect(screen.getByTestId('play-pause')).toHaveAttribute('aria-label', '暂停')
    await user.click(screen.getByTestId('play-pause'))
    expect(screen.getByTestId('play-pause')).toHaveAttribute('aria-label', '播放')

    // 倍速循环
    await user.click(screen.getByTestId('speed-button'))
    expect(screen.getByTestId('speed-button')).toHaveTextContent('1.5x')

    // 下一句推进
    await user.click(screen.getByRole('button', { name: '下一句' }))
    expect(screen.getByTestId('subtitle-line-1').className).toContain('current')
  })

  test('E2E：导入并处理 → 卡片进入深入学习 → 切换难度 → 整词输入即判分 → 下一句', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    // 导入并经 AI 预处理完成加工（分句 + 生词/短语 + 音源已持久化）
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'The quick brown fox jumps.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    await processViaAiPreprocess(user)

    // 进入深入学习
    await user.click(screen.getByRole('link', { name: /深入学习/ }))

    // 默认难度「重要词语」：首句无命中词语 → 无挖空输入框
    expect(screen.queryAllByTestId(/^blank-0-/)).toHaveLength(0)

    // 切换难度「全部听写」：首句词元全部挖空
    await user.click(screen.getByText('全部听写'))
    expect(screen.getAllByTestId(/^blank-0-/)).toHaveLength(11)

    // 整词输入首词 So（大小写容错）并回车判分
    await user.type(screen.getByTestId('blank-0-0'), 'so{Enter}')
    expect(screen.getByTestId('blank-0-0').className).toContain('blank-correct')

    // 下一句 + 切换「仅生词」：第二句仅 thesis 挖空（数据驱动）
    await user.click(screen.getByRole('button', { name: '下一句' }))
    await user.click(screen.getByText('仅生词'))
    expect(screen.getAllByTestId(/^blank-1-/)).toHaveLength(1)

    // 输入 thesis 全对 → 正确反馈
    await user.type(screen.getByTestId('blank-1-0'), 'thesis')
    await user.tab()
    expect(screen.getByTestId('blank-1-0').className).toContain('blank-correct')
  })

  test('E2E：导入并处理 → 听力挑战 → 作答三题型 → 提交判分 → 刷新题库轮换', async () => {
    const user = userEvent.setup()
    renderAtRoute('/articles')

    // 导入并经 AI 预处理完成加工
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    await user.type(screen.getByLabelText('粘贴文章内容'), 'The quick brown fox jumps.')
    await user.click(screen.getByRole('button', { name: /完成导入/ }))
    expect(await screen.findByText('已导入 1 篇')).toBeInTheDocument()
    await processViaAiPreprocess(user)

    // 进入深入学习，切到听力挑战 Tab
    await user.click(screen.getByRole('link', { name: /深入学习/ }))
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

    // 2) 深入学习（收听）：拖动进度条到 5s/10s → 50%
    await user.click(screen.getByRole('link', { name: /深入学习/ }))
    fireEvent.change(screen.getByTestId('progress-slider'), { target: { value: '5000' } })
    await user.click(screen.getByRole('link', { name: '返回文章列表' }))

    // 3) 深入学习（精听）：全部听写难度下填对首句所有空 → 1/2
    await user.click(screen.getByRole('link', { name: /深入学习/ }))
    await user.click(screen.getByText('全部听写'))
    // 首句 "The quick brown fox jumps." → 5 个空，全部填对触发句子完成
    const answers = ['the', 'quick', 'brown', 'fox', 'jumps']
    for (let i = 0; i < answers.length; i++) {
      const input = screen.getByTestId(`blank-0-${i}`)
      await user.type(input, `${answers[i]}{Enter}`)
    }
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
