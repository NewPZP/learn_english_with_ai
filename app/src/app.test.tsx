import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

/**
 * 工单「应用壳与项目脚手架」验收测试
 * 覆盖：侧边栏渲染与结构、导航切换、7 个路由可达、data-dom-id 锚点契约
 */
describe('应用壳', () => {
  test('渲染侧边栏：品牌 LinguaAI + 三项导航（文章/发现/我的→AI 配置）', () => {
    render(<App />)

    expect(screen.getByText('LinguaAI')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()

    // 导航项
    expect(screen.getByRole('link', { name: '文章' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发现' })).toBeDisabled()
    expect(screen.getByText('我的')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI 配置' })).toBeInTheDocument()
  })

  test('默认路由重定向到文章列表，侧边栏「文章」为激活态', () => {
    render(<App />)

    expect(screen.getByRole('link', { name: '文章' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { name: '文章列表' })).toBeInTheDocument()
  })

  test('布局契约：内容区结构存在（.app-shell / .app-content）', () => {
    render(<App />)

    expect(document.querySelector('.app-shell')).toBeInTheDocument()
    expect(document.querySelector('.sidebar-nav')).toBeInTheDocument()
    expect(document.querySelector('.app-content')).toBeInTheDocument()
    expect(document.querySelector('.app-content-inner')).toBeInTheDocument()
  })
})

describe('路由与 data-dom-id 锚点契约', () => {
  test('cta-import-article → 导入文章页 → cta-save-article → 返回文章列表', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: '导入文章' }))
    expect(screen.getByRole('link', { name: '完成导入' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '完成导入' }))
    expect(screen.getByRole('heading', { name: '文章列表' })).toBeInTheDocument()
  })

  test('学习模式锚点导航到骨架页（cta-word-preview / cta-podcast / cta-intensive-listening）', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: '单词预习' }))
    expect(screen.getByRole('heading', { name: '单词预习' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '返回文章列表' }))
    await user.click(screen.getByRole('link', { name: '播客' }))
    expect(screen.getByRole('heading', { name: '播客模式' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '返回文章列表' }))
    await user.click(screen.getByRole('link', { name: '听力训练' }))
    expect(screen.getByRole('heading', { name: '听力训练' })).toBeInTheDocument()
  })

  test('侧边栏 cta-ai-config 进入 AI 配置页，back-article-list 返回列表', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: 'AI 配置' }))
    expect(screen.getByRole('heading', { name: 'AI 配置' })).toBeInTheDocument()

    // AI 配置为当前激活态
    expect(screen.getByRole('link', { name: 'AI 配置' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // 顶栏返回按钮回到文章列表
    await user.click(screen.getByRole('link', { name: '返回文章列表' }))
    expect(screen.getByRole('heading', { name: '文章列表' })).toBeInTheDocument()
  })

  test('所有 data-dom-id 契约锚点存在于对应页面', async () => {
    const user = userEvent.setup()
    render(<App />)

    // 文章列表页锚点
    expect(document.querySelector('[data-dom-id="cta-import-article"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-word-preview"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-podcast"]')).toBeInTheDocument()
    expect(
      document.querySelector('[data-dom-id="cta-intensive-listening"]'),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="cta-ai-config"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="back-article-list"]')).toBeInTheDocument()

    // 导入页锚点
    await user.click(screen.getByRole('link', { name: '导入文章' }))
    expect(document.querySelector('[data-dom-id="cta-save-article"]')).toBeInTheDocument()
    expect(document.querySelector('[data-dom-id="back-article-list"]')).toBeInTheDocument()
  })
})
