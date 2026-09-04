/**
 * AI 配置领域模型与本地持久化
 * 文字模型（生词提取/摘要/出题）与声音模型（TTS）各自独立配置
 *
 * 存储说明：当前使用 localStorage 明文存储（Web 应用可行方案）；
 * 桌面壳打包后可升级为 Electron safeStorage 等系统级安全存储。
 */
import { proxied, randomRequestId } from './ai/devProxy'

export type VoiceType = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
export type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac'

/**
 * 声音服务协议：
 * - openai：/audio/speech 兼容端点（OpenAI、硅基流动等）
 * - volcano：火山豆包 TTS（X-Api-Key 鉴权 + req_params 请求体）
 */
export type VoiceProtocol = 'openai' | 'volcano'

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
  /** 服务协议：决定请求格式与鉴权方式（openai / volcano） */
  protocol: VoiceProtocol
  /** 音色：OpenAI 协议为枚举值，火山协议为控制台音色库 ID */
  voiceType: string
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
  // 默认 16384：30 词词条 JSON（含中文释义/例句/近义词）实测约 8–10k tokens，
  // 4096 会截断导致 JSON 解析失败（finish_reason=length）
  maxTokens: 16384,
  temperature: 0.7,
}

export const defaultVoiceConfig: VoiceModelConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'tts-1',
  protocol: 'openai',
  voiceType: 'alloy',
  audioFormat: 'mp3',
  speed: 1.0,
}

/** 火山豆包 TTS 协议默认值（切换协议时套用；音色 ID 需从控制台音色库复制） */
export const volcanoVoiceDefaults: Pick<
  VoiceModelConfig,
  'baseUrl' | 'modelName' | 'voiceType' | 'audioFormat'
> = {
  baseUrl: 'https://openspeech.bytedance.com',
  // 「模型名称」对应请求体 req_params.model，默认 seed-tts-2.0-standard
  // X-Api-Resource-Id 由适配器根据音色 ID 自动判断（ICL_ 前缀 → seed-icl-2.0）
  modelName: 'seed-tts-2.0-standard',
  voiceType: '',
  audioFormat: 'mp3',
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
    const voice = { ...defaultVoiceConfig, ...parsed.voice }
    // 旧版本配置无 protocol 字段，回落 openai
    if (voice.protocol !== 'volcano') voice.protocol = 'openai'
    return {
      provider: parsed.provider === 'real' ? 'real' : 'mock',
      text: { ...defaultTextConfig, ...parsed.text },
      voice,
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
 * 真实连接测试（OpenAI 兼容）：GET {baseUrl}/models 验证端点与 Key 可用性
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

/**
 * 判断音色是否为声音复刻（ICL）音色。
 * 火山复刻音色 ID 以 ICL_ 开头，需使用 seed-icl-2.0 作为 X-Api-Resource-Id。
 */
export function isIclVoice(voiceType: string): boolean {
  return voiceType.trim().toUpperCase().startsWith('ICL_')
}

/** 根据音色 ID 返回对应的 X-Api-Resource-Id */
export function volcanoResourceId(voiceType: string): 'seed-tts-2.0' | 'seed-icl-2.0' {
  return isIclVoice(voiceType) ? 'seed-icl-2.0' : 'seed-tts-2.0'
}

/**
 * 真实连接测试（火山豆包 TTS）：合成一句极短文本验证 Key 与音色
 * 火山无 /models 探测端点，端到端合成是最小可行验证（仅 3 字符计费）
 */
async function testVolcanoConnection(
  endpoint: Pick<ModelEndpoint, 'apiKey' | 'baseUrl' | 'modelName'>,
  voiceType: string,
): Promise<ConnectionTestResult> {
  if (!endpoint.apiKey.trim()) {
    return { ok: false, latencyMs: 0, message: 'API Key 未填写' }
  }
  if (!voiceType.trim()) {
    return { ok: false, latencyMs: 0, message: '音色 ID 未填写（从火山控制台音色库复制）' }
  }
  const start = Date.now()
  try {
    const response = await fetch(
      proxied(`${endpoint.baseUrl.replace(/\/+$/, '')}/api/v3/tts/unidirectional`),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': endpoint.apiKey,
          // X-Api-Resource-Id 根据音色自动判断：ICL 音色用 seed-icl-2.0，否则 seed-tts-2.0
          'X-Api-Resource-Id': volcanoResourceId(voiceType),
          'X-Api-Request-Id': randomRequestId(),
        },
        body: JSON.stringify({
          user: { uid: 'linguaai' },
          req_params: {
            text: 'Hi.',
            speaker: voiceType,
            // model 字段仅复刻音色（ICL_ 前缀）需指定，值为模型版本 seed-icl-2.0；
            // 普通音色不携带 model，使用服务端默认（seed-tts-2.0）
            ...(isIclVoice(voiceType) ? { model: 'seed-icl-2.0' } : {}),
            audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: 0 },
          },
        }),
      },
    )
    const latencyMs = Date.now() - start
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const message = detail ? `HTTP ${response.status}：${detail.slice(0, 120)}` : `服务返回 HTTP ${response.status}`
      return { ok: false, latencyMs, message }
    }
    // 火山以 200 + JSON 返回错误（code != 0），需识别
    const raw = await response.text()
    let code: number | undefined
    try {
      const parsed = JSON.parse(raw) as { code?: number }
      code = parsed.code
    } catch {
      /* 非 JSON 响应视为成功 */
    }
    if (code !== undefined && code !== 0) {
      return { ok: false, latencyMs, message: `服务返回错误 code=${code}` }
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

/**
 * 连接测试入口：按数据来源模式分流（mock 模拟 / real 真实请求）
 * real 模式下声音模型若为火山协议，走火山专用的端到端合成验证
 */
export async function testConnection(
  endpoint: Pick<ModelEndpoint, 'apiKey' | 'baseUrl'> & Partial<Pick<ModelEndpoint, 'modelName'>>,
  mode: ProviderMode = 'mock',
  voice?: Pick<VoiceModelConfig, 'protocol' | 'voiceType'>,
): Promise<ConnectionTestResult> {
  if (mode === 'real' && voice?.protocol === 'volcano') {
    return testVolcanoConnection(
      { modelName: 'seed-tts-2.0', ...endpoint },
      voice.voiceType,
    )
  }
  return mode === 'real' ? testRealConnection(endpoint) : testMockConnection(endpoint)
}
