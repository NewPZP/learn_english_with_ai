/**
 * AI 配置领域模型与本地持久化
 * 文字模型（生词提取/摘要/出题）与声音模型（TTS）各自独立配置
 *
 * 存储说明：当前使用 localStorage 明文存储（Web 应用可行方案）；
 * 桌面壳打包后可升级为 Electron safeStorage 等系统级安全存储。
 */
import { proxied } from './ai/devProxy'

export type VoiceType = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
export type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac'

/** 数据来源模式：mock 演示数据 / 真实 AI 接口（OpenAI 兼容） */
export type ProviderMode = 'mock' | 'real'

/** 两个模型共享的端点配置（Data Clump 收敛） */
export interface ModelEndpoint {
  apiKey: string
  baseUrl: string
  modelName: string
}

/** 文字模型配置（5 项） */
export interface TextModelConfig extends ModelEndpoint {
  maxTokens: number
  temperature: number // 0–2，步进 0.1
}

/** 声音模型配置（6 项） */
export interface VoiceModelConfig extends ModelEndpoint {
  voiceType: VoiceType
  audioFormat: AudioFormat
  speed: number // 0.5–2.0，步进 0.1
}

export interface AiConfig {
  /** 数据来源模式（全局）：mock / real；real 下未填 Key 的模型自动回落 mock */
  provider: ProviderMode
  text: TextModelConfig
  voice: VoiceModelConfig
}

export const defaultTextConfig: TextModelConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4o',
  maxTokens: 4096,
  temperature: 0.7,
}

export const defaultVoiceConfig: VoiceModelConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'tts-1',
  voiceType: 'alloy',
  audioFormat: 'mp3',
  speed: 1.0,
}

const STORAGE_KEY = 'linguaai.ai-config'

function defaultConfig(): AiConfig {
  return { provider: 'mock', text: { ...defaultTextConfig }, voice: { ...defaultVoiceConfig } }
}

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultConfig()
    const parsed = JSON.parse(raw) as Partial<AiConfig>
    return {
      provider: parsed.provider === 'real' ? 'real' : 'mock',
      text: { ...defaultTextConfig, ...parsed.text },
      voice: { ...defaultVoiceConfig, ...parsed.voice },
    }
  } catch {
    return defaultConfig()
  }
}

function saveSection<K extends 'text' | 'voice'>(
  section: K,
  config: AiConfig[K],
): void {
  const current = loadAiConfig()
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...current, [section]: config }),
  )
}

export function saveTextConfig(config: TextModelConfig): void {
  saveSection('text', config)
}

export function saveVoiceConfig(config: VoiceModelConfig): void {
  saveSection('voice', config)
}

/** 切换数据来源模式（立即持久化，不影响已保存的模型配置） */
export function saveProviderMode(provider: ProviderMode): void {
  const current = loadAiConfig()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, provider }))
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  message: string
}

/**
 * Mock 连接测试：模拟网络延迟后返回结果（Key 非空即成功）
 */
async function testMockConnection(
  endpoint: Pick<ModelEndpoint, 'apiKey'>,
): Promise<ConnectionTestResult> {
  const latencyMs = 180 + Math.floor(Math.random() * 320)

  await new Promise((resolve) => setTimeout(resolve, latencyMs))

  if (!endpoint.apiKey.trim()) {
    return {
      ok: false,
      latencyMs,
      message: 'API Key 未填写',
    }
  }
  return {
    ok: true,
    latencyMs,
    message: '连接正常',
  }
}

/**
 * 真实连接测试：GET {baseUrl}/models 验证端点与 Key 可用性
 * 开发模式下经 /dev-proxy 同源代理转发，绕过浏览器 CORS 限制
 */
async function testRealConnection(
  endpoint: Pick<ModelEndpoint, 'apiKey' | 'baseUrl'>,
): Promise<ConnectionTestResult> {
  if (!endpoint.apiKey.trim()) {
    return { ok: false, latencyMs: 0, message: 'API Key 未填写' }
  }
  const start = Date.now()
  try {
    const response = await fetch(proxied(`${endpoint.baseUrl.replace(/\/+$/, '')}/models`), {
      headers: { Authorization: `Bearer ${endpoint.apiKey}` },
    })
    const latencyMs = Date.now() - start
    if (!response.ok) {
      return { ok: false, latencyMs, message: `服务返回 HTTP ${response.status}` }
    }
    return { ok: true, latencyMs, message: '连接正常' }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : '网络请求失败',
    }
  }
}

/** 连接测试入口：按数据来源模式分流（mock 模拟 / real 真实请求） */
export async function testConnection(
  endpoint: Pick<ModelEndpoint, 'apiKey' | 'baseUrl'>,
  mode: ProviderMode = 'mock',
): Promise<ConnectionTestResult> {
  return mode === 'real' ? testRealConnection(endpoint) : testMockConnection(endpoint)
}
