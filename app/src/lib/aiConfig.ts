/**
 * AI 配置领域模型与本地持久化
 * 文字模型（生词提取/摘要/出题）与声音模型（TTS）各自独立配置
 */

export type VoiceType = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
export type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac'

/** 文字模型配置（5 项） */
export interface TextModelConfig {
  apiKey: string
  baseUrl: string
  modelName: string
  maxTokens: number
  temperature: number // 0–2，步进 0.1
}

/** 声音模型配置（6 项） */
export interface VoiceModelConfig {
  apiKey: string
  baseUrl: string
  modelName: string
  voiceType: VoiceType
  audioFormat: AudioFormat
  speed: number // 0.5–2.0，步进 0.1
}

export interface AiConfig {
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

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { text: { ...defaultTextConfig }, voice: { ...defaultVoiceConfig } }
    }
    const parsed = JSON.parse(raw) as Partial<AiConfig>
    return {
      text: { ...defaultTextConfig, ...parsed.text },
      voice: { ...defaultVoiceConfig, ...parsed.voice },
    }
  } catch {
    return { text: { ...defaultTextConfig }, voice: { ...defaultVoiceConfig } }
  }
}

export function saveTextConfig(config: TextModelConfig): void {
  const current = loadAiConfig()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, text: config }))
}

export function saveVoiceConfig(config: VoiceModelConfig): void {
  const current = loadAiConfig()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, voice: config }))
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  message: string
}

/**
 * Mock 连接测试：模拟网络延迟后返回结果
 * 真实连通性由「AI 服务适配器层」工单接入
 */
export async function testConnection(
  config: { apiKey: string; baseUrl: string },
): Promise<ConnectionTestResult> {
  const latencyMs = 180 + Math.floor(Math.random() * 320)

  await new Promise((resolve) => setTimeout(resolve, latencyMs))

  if (!config.apiKey.trim()) {
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
