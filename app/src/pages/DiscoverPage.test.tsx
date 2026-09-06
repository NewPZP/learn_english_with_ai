import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { DiscoverPage } from './DiscoverPage'
import { routes } from '../routes'

describe('发现页（频道广场）', () => {
  beforeEach(() => localStorage.clear())

  test('渲染标题"发现"和频道介绍文案', () => {
    render(
      <BrowserRouter>
        <DiscoverPage />
      </BrowserRouter>,
    )
    expect(screen.getByRole('heading', { name: '发现' })).toBeInTheDocument()
    expect(screen.getByText(/浏览精选频道/)).toBeInTheDocument()
  })

  test('渲染所有注册频道卡片（TED + BBC + VOA）', () => {
    render(
      <BrowserRouter>
        <DiscoverPage />
      </BrowserRouter>,
    )
    expect(screen.getByTestId('channel-card-ted')).toBeInTheDocument()
    expect(screen.getByTestId('channel-card-bbc')).toBeInTheDocument()
    expect(screen.getByTestId('channel-card-voa')).toBeInTheDocument()
  })

  test('TED 频道卡片可点击，导航到 /discover/ted', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[routes.discover]}>
        <Routes>
          <Route path={routes.discover} element={<DiscoverPage />} />
          <Route path="/discover/ted" element={<div>TED Channel Page</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByTestId('channel-card-ted'))
    expect(screen.getByText('TED Channel Page')).toBeInTheDocument()
  })

  test('不可用频道显示"即将上线"且不可点击', () => {
    render(
      <BrowserRouter>
        <DiscoverPage />
      </BrowserRouter>,
    )
    const bbcCard = screen.getByTestId('channel-card-bbc')
    expect(bbcCard).toHaveTextContent('即将上线')
    expect(bbcCard).not.toHaveRole('link')
  })
})
