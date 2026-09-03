import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { App } from '../App'
import { ImportArticlePage } from './ImportArticlePage'
import { ArticleListPage } from './ArticleListPage'

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

    expect(await screen.findByLabelText('粘贴文章内容')).toHaveValue('file content here')
  })
})

describe('导入 → 列表完整流程', () => {
  beforeEach(() => localStorage.clear())

  test('粘贴文本 → 完成导入 → 列表出现新卡片', async () => {
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

    // 回到列表，新卡片出现（卡片标题为首句推导）
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
