import { describe, test, expect, beforeEach } from 'vitest'
import {
  loadAiConfig,
  saveTextConfig,
  saveVoiceConfig,
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

describe('mock 连接测试', () => {
  test('API Key 为空时返回失败', async () => {
    const result = await testConnection({ apiKey: '', baseUrl: 'https://api.x.com' })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('API Key 未填写')
  })

  test('API Key 非空时返回成功与延迟', async () => {
    const result = await testConnection({ apiKey: 'sk-x', baseUrl: 'https://api.x.com' })
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThan(0)
  })
})
