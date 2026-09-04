import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadAiConfig,
  saveTextConfig,
  saveVoiceConfig,
  saveProviderMode,
  testConnection,
  defaultTextConfig,
  defaultVoiceConfig,
} from './aiConfig'

describe('AI 配置存储', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('无存储时返回默认配置', () => {
    const config = loadAiConfig()
    expect(config.text).toEqual(defaultTextConfig)
    expect(config.voice).toEqual(defaultVoiceConfig)
  })

  test('保存文字配置后可读取，且不影响声音配置', () => {
    saveTextConfig({ ...defaultTextConfig, apiKey: 'sk-test', temperature: 1.2 })

    const config = loadAiConfig()
    expect(config.text.apiKey).toBe('sk-test')
    expect(config.text.temperature).toBe(1.2)
    expect(config.voice).toEqual(defaultVoiceConfig)
  })

  test('保存声音配置后可读取，且不影响文字配置', () => {
    saveVoiceConfig({ ...defaultVoiceConfig, apiKey: 'vk-test', speed: 1.5 })

    const config = loadAiConfig()
    expect(config.voice.apiKey).toBe('vk-test')
    expect(config.voice.speed).toBe(1.5)
    expect(config.text).toEqual(defaultTextConfig)
  })

  test('损坏的存储数据回退到默认值', () => {
    localStorage.setItem('linguaai.ai-config', '{invalid json')
    const config = loadAiConfig()
    expect(config.text).toEqual(defaultTextConfig)
    expect(config.voice).toEqual(defaultVoiceConfig)
  })
})

describe('数据来源模式（mock / real）', () => {
  beforeEach(() => localStorage.clear())

  test('默认为 mock 演示数据', () => {
    expect(loadAiConfig().provider).toBe('mock')
  })

  test('切换到 real 后可读取，且不影响已保存的模型配置', () => {
    saveTextConfig({ ...defaultTextConfig, apiKey: 'sk-keep' })
    saveProviderMode('real')

    const config = loadAiConfig()
    expect(config.provider).toBe('real')
    expect(config.text.apiKey).toBe('sk-keep')
    expect(config.voice).toEqual(defaultVoiceConfig)
  })

  test('存储中的非法 provider 值回落 mock（旧版本数据兼容）', () => {
    localStorage.setItem('linguaai.ai-config', JSON.stringify({ provider: 'whatever' }))
    expect(loadAiConfig().provider).toBe('mock')
  })
})

describe('mock 连接测试', () => {
  test('API Key 为空时返回失败', async () => {
    const result = await testConnection({ apiKey: '', baseUrl: 'https://api.openai.com/v1' })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('API Key 未填写')
  })

  test('API Key 非空时返回成功与延迟', async () => {
    const result = await testConnection({ apiKey: 'sk-x', baseUrl: 'https://api.openai.com/v1' })
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThan(0)
  })
})

describe('真实连接测试（real 模式请求 /models）', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('端点可达时返回成功与真实延迟', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const result = await testConnection(
      { apiKey: 'sk-live', baseUrl: 'https://api.example.com/v1/' },
      'real',
    )

    expect(result.ok).toBe(true)
    expect(result.message).toBe('连接正常')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-live' } }),
    )
  })

  test('服务返回 401 时失败并带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const result = await testConnection(
      { apiKey: 'sk-bad', baseUrl: 'https://api.example.com/v1' },
      'real',
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('HTTP 401')
  })

  test('网络异常时失败并返回错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))

    const result = await testConnection(
      { apiKey: 'sk-live', baseUrl: 'https://api.example.com/v1' },
      'real',
    )

    expect(result.ok).toBe(false)
    expect(result.message).toBe('fetch failed')
  })

  test('未填 API Key 时不发请求直接失败', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await testConnection(
      { apiKey: '  ', baseUrl: 'https://api.example.com/v1' },
      'real',
    )

    expect(result.ok).toBe(false)
    expect(result.message).toBe('API Key 未填写')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
