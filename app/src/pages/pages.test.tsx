import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { App } from '../App'
import { ImportArticlePage } from './ImportArticlePage'
import { ArticleListPage } from './ArticleListPage'
import { defaultTextConfig, defaultVoiceConfig } from '../lib/aiConfig'
import { MockTextAdapter, MockVoiceAdapter } from '../lib/ai/mockAdapters'
import type { PipelineAdapters } from '../lib/processing/pipeline'

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

    // 处理产物持久化并与文章关联
    const stored = JSON.parse(localStorage.getItem('linguaai.articles') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].processing.words).toHaveLength(32)
    expect(stored[0].processing.phrases).toHaveLength(8)
    expect(stored[0].processing.sentences.length).toBeGreaterThanOrEqual(5)

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
