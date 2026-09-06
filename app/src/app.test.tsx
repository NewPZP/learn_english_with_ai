import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

/**
 * 工单「应用壳与项目脚手架」验收测试
 * 覆盖：侧边栏渲染与结构、导航切换、核心路由可达、data-dom-id 锚点契约
 * （学习模式入口锚点已迁移至文章卡片内，见 pages.test.tsx）
 */
describe('应用壳', () => {
  beforeEach(() => localStorage.clear())

  test('渲染侧边栏：品牌 LinguaAI + 三项导航（文章/发现/我的→AI 配置）', () => {
    render(<App />)

    expect(screen.getByText('LinguaAI')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()

    // 导航项
    expect(screen.getByRole('link', { name: '文章' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '发现' })).toBeInTheDocument()
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
  beforeEach(() => localStorage.clear())

  test('cta-import-article → 导入文章页（含 cta-save-article 与 back-article-list）', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: '导入文章' }))
    expect(screen.getByRole('heading', { name: '导入文章' })).toBeInTheDocument()
    expect(
      document.querySelector('[data-dom-id="cta-save-article"]'),
    ).toBeInTheDocument()
    expect(
      document.querySelector('[data-dom-id="back-article-list"]'),
    ).toBeInTheDocument()
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
})
