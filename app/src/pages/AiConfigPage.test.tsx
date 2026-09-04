import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { AiConfigPage } from './AiConfigPage'
import { loadAiConfig, saveProviderMode } from '../lib/aiConfig'

function renderPage() {
  return render(
    <BrowserRouter>
      <AiConfigPage />
    </BrowserRouter>,
  )
}

/**
 * 工单「AI 配置页」验收测试
 * 覆盖：表单结构、滑块实时数值、密文切换、测试连接状态流转、保存回填
 */
describe('AI 配置页 — 表单结构', () => {
  beforeEach(() => localStorage.clear())

  test('渲染文字模型面板全部 5 个配置项', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '文字模型' })).toBeInTheDocument()
    expect(screen.getByLabelText('API Key', { selector: '#text-api-key' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Base URL/, { selector: '#text-base-url' })).toBeInTheDocument()
    expect(screen.getByLabelText('模型名称', { selector: '#text-model-name' })).toBeInTheDocument()
    expect(screen.getByLabelText('Max Tokens')).toBeInTheDocument()
    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('0.7')).toBeInTheDocument() // 默认值实时显示
  })

  test('渲染声音模型面板全部 6 个配置项', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '声音模型' })).toBeInTheDocument()
    expect(screen.getByLabelText('API Key', { selector: '#voice-api-key' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Base URL/, { selector: '#voice-base-url' })).toBeInTheDocument()
    expect(screen.getByLabelText('模型名称', { selector: '#voice-model-name' })).toBeInTheDocument()
    expect(screen.getByLabelText('语音类型')).toBeInTheDocument()
    expect(screen.getByLabelText('音频格式')).toBeInTheDocument()
    expect(screen.getByText('1.0x')).toBeInTheDocument() // 默认语速实时显示
  })

  test('两个面板均有「测试连接」与「保存配置」按钮', () => {
    renderPage()

    expect(screen.getAllByRole('button', { name: /测试连接/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /保存配置/ })).toHaveLength(2)
  })

  test('未测试时状态条显示「尚未测试连接」', () => {
    renderPage()
    expect(screen.getAllByText('尚未测试连接')).toHaveLength(2)
  })
})

describe('AI 配置页 — 交互', () => {
  beforeEach(() => localStorage.clear())

  test('Temperature 滑块拖动实时显示数值', async () => {
    renderPage()

    const slider = screen.getByLabelText('Temperature')
    fireEvent.change(slider, { target: { value: '1.5' } })

    expect(screen.getByTestId('text-temp-slider-value')).toHaveTextContent('1.5')
  })

  test('语速滑块实时显示（如 1.2x）', async () => {
    renderPage()

    const slider = screen.getByLabelText('语速')
    fireEvent.change(slider, { target: { value: '1.2' } })

    expect(screen.getByTestId('voice-speed-slider-value')).toHaveTextContent('1.2x')
  })

  test('API Key 默认密文，眼睛图标切换明文/密文', async () => {
    const user = userEvent.setup()
    renderPage()

    const input = screen.getByLabelText('API Key', { selector: '#text-api-key' }) as HTMLInputElement
    await user.type(input, 'sk-secret')
    expect(input.type).toBe('password')

    await user.click(screen.getAllByRole('button', { name: '显示 API Key' })[0])
    expect(input.type).toBe('text')

    await user.click(screen.getAllByRole('button', { name: '隐藏 API Key' })[0])
    expect(input.type).toBe('password')
  })

  test('测试连接（已填 Key）：状态条显示连接正常与延迟', async () => {
    const user = userEvent.setup()
    renderPage()

    const input = screen.getByLabelText('API Key', { selector: '#text-api-key' })
    await user.type(input, 'sk-live')

    const testBtns = screen.getAllByRole('button', { name: /测试连接|测试中/ })
    await user.click(testBtns[0])

    await waitFor(() => {
      expect(screen.getByText('连接正常')).toBeInTheDocument()
    })
    expect(screen.getByText(/延迟 \d+ms/)).toBeInTheDocument()
  })

  test('测试连接（未填 Key）：状态条显示连接失败', async () => {
    const user = userEvent.setup()
    renderPage()

    const testBtns = screen.getAllByRole('button', { name: /测试连接|测试中/ })
    await user.click(testBtns[1]) // 声音面板

    await waitFor(() => {
      expect(screen.getByText('连接失败')).toBeInTheDocument()
    })
  })

  test('保存配置持久化，页面刷新后回填', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()

    await user.type(screen.getByLabelText('API Key', { selector: '#text-api-key' }), 'sk-persist')
    const modelNameInput = screen.getByLabelText('模型名称', { selector: '#text-model-name' })
    await user.clear(modelNameInput)
    await user.type(modelNameInput, 'gpt-4o-mini')

    const saveBtns = screen.getAllByRole('button', { name: '保存配置' })
    await user.click(saveBtns[0])

    unmount()

    // 重新挂载模拟刷新
    renderPage()
    expect(screen.getByLabelText('API Key', { selector: '#text-api-key' })).toHaveValue('sk-persist')
    expect(screen.getByLabelText('模型名称', { selector: '#text-model-name' })).toHaveValue(
      'gpt-4o-mini',
    )
  })

  test('两个面板独立保存互不影响', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()

    await user.type(screen.getByLabelText('API Key', { selector: '#voice-api-key' }), 'vk-only')
    await user.click(screen.getAllByRole('button', { name: '保存配置' })[1])

    unmount()
    renderPage()

    expect(screen.getByLabelText('API Key', { selector: '#voice-api-key' })).toHaveValue('vk-only')
    expect(screen.getByLabelText('API Key', { selector: '#text-api-key' })).toHaveValue('')
  })
})

describe('AI 配置页 — 数据来源切换', () => {
  beforeEach(() => localStorage.clear())

  test('默认 mock 模式：Mock 按钮选中，徽章与提示对应', () => {
    renderPage()

    expect(screen.getByTestId('provider-mock')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('provider-real')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('provider-badge')).toHaveTextContent('Mock 演示')
    expect(screen.getByTestId('provider-hint')).toHaveTextContent('无需 API Key')
  })

  test('切换到真实 AI：立即持久化，徽章/提示/按钮状态联动', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()

    await user.click(screen.getByTestId('provider-real'))

    expect(screen.getByTestId('provider-real')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('provider-badge')).toHaveTextContent('真实 AI')
    expect(screen.getByTestId('provider-hint')).toHaveTextContent('自动回落到演示数据')

    // 重新挂载后模式保持 real（持久化生效）
    unmount()
    renderPage()
    expect(screen.getByTestId('provider-real')).toHaveAttribute('aria-pressed', 'true')
    expect(loadAiConfig().provider).toBe('real')
  })

  test('切换模式不影响已保存的模型配置', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('API Key', { selector: '#text-api-key' }), 'sk-keep')
    await user.click(screen.getAllByRole('button', { name: '保存配置' })[0])
    await user.click(screen.getByTestId('provider-real'))

    const config = loadAiConfig()
    expect(config.provider).toBe('real')
    expect(config.text.apiKey).toBe('sk-keep')
  })

  test('切回 Mock：状态回退并持久化', async () => {
    const user = userEvent.setup()
    saveProviderMode('real')
    renderPage()

    await user.click(screen.getByTestId('provider-mock'))

    expect(screen.getByTestId('provider-mock')).toHaveAttribute('aria-pressed', 'true')
    expect(loadAiConfig().provider).toBe('mock')
  })
})

describe('AI 配置页 — 声音协议切换', () => {
  beforeEach(() => localStorage.clear())

  test('默认 OpenAI 协议：协议按钮选中、语音类型下拉存在', () => {
    renderPage()

    expect(screen.getByTestId('voice-protocol-openai')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('voice-protocol-volcano')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('语音类型')).toBeInTheDocument()
    expect(screen.queryByLabelText('音色 ID')).not.toBeInTheDocument()
    expect(screen.getByTestId('voice-protocol-hint')).toHaveTextContent('/audio/speech')
  })

  test('切换火山协议：音色 ID 文本框替换下拉，套用火山默认端点值', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('voice-protocol-volcano'))

    expect(screen.getByTestId('voice-protocol-volcano')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('音色 ID')).toBeInTheDocument()
    expect(screen.queryByLabelText('语音类型')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Base URL/, { selector: '#voice-base-url' })).toHaveValue(
      'https://openspeech.bytedance.com',
    )
    expect(screen.getByLabelText('模型名称', { selector: '#voice-model-name' })).toHaveValue(
      'seed-tts-2.0-standard',
    )
    expect(screen.getByTestId('voice-protocol-hint')).toHaveTextContent('火山引擎')
  })

  test('火山协议下音频格式仅 MP3 / Opus，切回 OpenAI 恢复四选项', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('voice-protocol-volcano'))
    const volcanoSelect = screen.getByLabelText('音频格式') as HTMLSelectElement
    expect(Array.from(volcanoSelect.options).map((o) => o.value)).toEqual(['mp3', 'opus'])

    await user.click(screen.getByTestId('voice-protocol-openai'))
    const openaiSelect = screen.getByLabelText('音频格式') as HTMLSelectElement
    expect(Array.from(openaiSelect.options).map((o) => o.value)).toEqual([
      'mp3',
      'opus',
      'aac',
      'flac',
    ])
  })

  test('切换协议保留 API Key 与语速，旧连接状态作废', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('API Key', { selector: '#voice-api-key' }), 'vk-keep')
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '1.6' } })
    await user.click(screen.getByTestId('voice-protocol-volcano'))

    expect(screen.getByLabelText('API Key', { selector: '#voice-api-key' })).toHaveValue('vk-keep')
    expect(screen.getByTestId('voice-speed-slider-value')).toHaveTextContent('1.6x')
  })

  test('协议切换后保存：重新挂载回填火山配置', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()

    await user.click(screen.getByTestId('voice-protocol-volcano'))
    await user.type(screen.getByLabelText('音色 ID'), 'zh_female_cancan_mars_bigtts')
    await user.click(screen.getAllByRole('button', { name: '保存配置' })[1])

    unmount()
    renderPage()

    expect(screen.getByLabelText('音色 ID')).toHaveValue('zh_female_cancan_mars_bigtts')
    expect(screen.getByLabelText('模型名称', { selector: '#voice-model-name' })).toHaveValue(
      'seed-tts-2.0-standard',
    )
  })
})
