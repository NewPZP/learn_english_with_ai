import { useState } from 'react'
import { Type, AudioLines, Database, FlaskConical, Zap } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import {
  ConfigBadge,
  ConnectionStatusBar,
  EndpointFields,
  FieldLabel,
  PanelActions,
  RangeField,
} from '../components/ConfigPanel'
import {
  defaultVoiceConfig,
  loadAiConfig,
  saveProviderMode,
  saveTextConfig,
  saveVoiceConfig,
  volcanoVoiceDefaults,
  type AiConfig,
  type AudioFormat,
  type ConnectionTestResult,
  type ProviderMode,
  type VoiceModelConfig,
  type VoiceProtocol,
} from '../lib/aiConfig'

const VOICE_TYPES: { value: string; label: string }[] = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'nova', label: 'Nova' },
  { value: 'shimmer', label: 'Shimmer' },
]

const AUDIO_FORMATS: { value: AudioFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'opus', label: 'Opus' },
  { value: 'aac', label: 'AAC' },
  { value: 'flac', label: 'FLAC' },
]

/** 火山协议仅支持 mp3 / ogg_opus（aac / flac 回落 mp3），下拉仅展示可选项 */
const VOLCANO_AUDIO_FORMATS = AUDIO_FORMATS.filter((f) => f.value === 'mp3' || f.value === 'opus')

const VOICE_PROTOCOLS: { value: VoiceProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'volcano', label: '火山豆包 TTS' },
]

/** 切换协议时套用的端点默认值（保留 API Key 与语速） */
function protocolDefaults(protocol: VoiceProtocol): Partial<VoiceModelConfig> {
  if (protocol === 'volcano') return { protocol, ...volcanoVoiceDefaults }
  const { baseUrl, modelName, voiceType, audioFormat } = defaultVoiceConfig
  return { protocol, baseUrl, modelName, voiceType, audioFormat }
}

/**
 * AI 配置页：数据来源切换 + 文字/声音模型双面板
 * 数据来源全局生效并立即持久化；real 模式下未填 Key 的模型自动回落 mock
 */
export function AiConfigPage() {
  const [config, setConfig] = useState<AiConfig>(() => loadAiConfig())
  const [textStatus, setTextStatus] = useState<ConnectionTestResult | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<ConnectionTestResult | null>(null)

  const updateText = (patch: Partial<AiConfig['text']>) =>
    setConfig((c) => ({ ...c, text: { ...c.text, ...patch } }))
  const updateVoice = (patch: Partial<AiConfig['voice']>) =>
    setConfig((c) => ({ ...c, voice: { ...c.voice, ...patch } }))

  /** 切换声音服务协议：套用对应端点默认值（保留 API Key 与语速），旧连接状态作废 */
  const switchVoiceProtocol = (protocol: VoiceProtocol) => {
    setConfig((c) =>
      c.voice.protocol === protocol ? c : { ...c, voice: { ...c.voice, ...protocolDefaults(protocol) } },
    )
    setVoiceStatus(null)
  }

  /** 数据来源切换：立即持久化（模式是全局开关，无需走「保存配置」） */
  const switchProvider = (mode: ProviderMode) => {
    setConfig((c) => (c.provider === mode ? c : { ...c, provider: mode }))
    saveProviderMode(mode)
  }

  const isReal = config.provider === 'real'

  return (
    <>
      <PageTopbar title="AI 配置" />
      <div className="app-content-inner">
        <div className="ai-config-container">
          {/* ====== 数据来源切换 ====== */}
          <section className="config-panel" aria-labelledby="provider-title" data-testid="provider-panel">
            <div className="config-header">
              <div className="config-icon provider-mode">
                <Database size={22} />
              </div>
              <div className="config-title-wrap">
                <h2 className="config-title" id="provider-title">数据来源</h2>
                <p className="config-desc">切换演示数据与真实 AI 接口（全局生效，立即保存）</p>
              </div>
              <span className={`provider-badge ${config.provider}`} data-testid="provider-badge">
                {isReal ? '真实 AI' : 'Mock 演示'}
              </span>
            </div>

            <div className="provider-switch" role="group" aria-label="数据来源切换">
              <button
                type="button"
                className="provider-option"
                data-testid="provider-mock"
                aria-pressed={!isReal}
                onClick={() => switchProvider('mock')}
              >
                <FlaskConical size={16} />
                <span>Mock 演示数据</span>
              </button>
              <button
                type="button"
                className="provider-option"
                data-testid="provider-real"
                aria-pressed={isReal}
                onClick={() => switchProvider('real')}
              >
                <Zap size={16} />
                <span>真实 AI 接口</span>
              </button>
            </div>

            <p className="provider-hint" data-testid="provider-hint">
              {isReal
                ? '调用下方配置的 OpenAI 兼容接口处理你的文章；未填写 API Key 的模型将自动回落到演示数据。'
                : '使用内置演示数据（固定生词表与提示音音频），无需 API Key，适合体验完整学习流程。'}
            </p>
          </section>

          {/* ====== 文字模型配置 ====== */}
          <section className="config-panel" aria-labelledby="text-model-title">
            <div className="config-header">
              <div className="config-icon text-model">
                <Type size={22} />
              </div>
              <div className="config-title-wrap">
                <h2 className="config-title" id="text-model-title">文字模型</h2>
                <p className="config-desc">用于生词提取、文章摘要、理解问答</p>
              </div>
              <ConfigBadge connected={textStatus?.ok ?? false} />
            </div>

            <EndpointFields
              prefix="text-"
              modelPlaceholder="gpt-4o"
              endpoint={config.text}
              onChange={updateText}
            />

            <div className="form-row">
              <div className="form-group">
                <FieldLabel htmlFor="text-max-tokens">Max Tokens</FieldLabel>
                <input
                  id="text-max-tokens"
                  type="number"
                  className="form-input"
                  min={1}
                  max={128000}
                  value={config.text.maxTokens}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10)
                    updateText({ maxTokens: Number.isNaN(parsed) ? 1 : Math.max(1, parsed) })
                  }}
                />
              </div>
            </div>

            <RangeField
              id="text-temp-slider"
              label="Temperature"
              min={0}
              max={2}
              step={0.1}
              value={config.text.temperature}
              format={(v) => v.toFixed(1)}
              onChange={(temperature) => updateText({ temperature })}
            />

            <PanelActions
              testId="text-test-btn"
              saveId="text-save-btn"
              endpoint={config.text}
              mode={config.provider}
              onSave={() => saveTextConfig(config.text)}
              onTested={setTextStatus}
            />
            <ConnectionStatusBar result={textStatus} />
          </section>

          {/* ====== 声音模型配置 ====== */}
          <section className="config-panel" aria-labelledby="voice-model-title">
            <div className="config-header">
              <div className="config-icon voice-model">
                <AudioLines size={22} />
              </div>
              <div className="config-title-wrap">
                <h2 className="config-title" id="voice-model-title">声音模型</h2>
                <p className="config-desc">用于生成文章语音、播客音频</p>
              </div>
              <ConfigBadge connected={voiceStatus?.ok ?? false} />
            </div>

            <div className="provider-switch" role="group" aria-label="声音服务协议切换">
              {VOICE_PROTOCOLS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className="provider-option"
                  data-testid={`voice-protocol-${p.value}`}
                  aria-pressed={config.voice.protocol === p.value}
                  onClick={() => switchVoiceProtocol(p.value)}
                >
                  <span>{p.label}</span>
                </button>
              ))}
            </div>

            <p className="provider-hint" data-testid="voice-protocol-hint">
              {config.voice.protocol === 'volcano'
                ? '火山引擎豆包 TTS：Base URL 填 openspeech.bytedance.com；音色 ID 从控制台「语音技术 → 音色库」复制（ICL_ 开头为复刻音色）；模型名称即请求体 model（默认 seed-tts-2.0-standard，复刻音色需指定）；X-Api-Resource-Id 由音色自动判断。仅支持 MP3 / Opus。'
                : '通过 OpenAI 兼容的 /audio/speech 接口合成语音（OpenAI、硅基流动等）。'}
            </p>

            <EndpointFields
              prefix="voice-"
              modelPlaceholder={config.voice.protocol === 'volcano' ? 'seed-tts-2.0-standard' : 'tts-1'}
              endpoint={config.voice}
              onChange={updateVoice}
            />

            <div className="form-row">
              {config.voice.protocol === 'volcano' ? (
                <div className="form-group">
                  <FieldLabel htmlFor="voice-type">音色 ID</FieldLabel>
                  <input
                    id="voice-type"
                    type="text"
                    className="form-input"
                    placeholder="从控制台音色库复制，如 zh_female_cancan_mars_bigtts"
                    value={config.voice.voiceType}
                    onChange={(e) => updateVoice({ voiceType: e.target.value })}
                  />
                </div>
              ) : (
                <div className="form-group">
                  <FieldLabel htmlFor="voice-type">语音类型</FieldLabel>
                  <select
                    id="voice-type"
                    className="form-select"
                    value={config.voice.voiceType}
                    onChange={(e) => updateVoice({ voiceType: e.target.value })}
                  >
                    {VOICE_TYPES.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <FieldLabel htmlFor="audio-format">音频格式</FieldLabel>
                <select
                  id="audio-format"
                  className="form-select"
                  value={config.voice.audioFormat}
                  onChange={(e) => updateVoice({ audioFormat: e.target.value as AudioFormat })}
                >
                  {(config.voice.protocol === 'volcano' ? VOLCANO_AUDIO_FORMATS : AUDIO_FORMATS).map(
                    (f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ),
                  )}
                </select>
              </div>
            </div>

            <RangeField
              id="voice-speed-slider"
              label="语速"
              min={0.5}
              max={2}
              step={0.1}
              value={config.voice.speed}
              format={(v) => `${v.toFixed(1)}x`}
              onChange={(speed) => updateVoice({ speed })}
            />

            <PanelActions
              testId="voice-test-btn"
              saveId="voice-save-btn"
              endpoint={config.voice}
              mode={config.provider}
              voice={{ protocol: config.voice.protocol, voiceType: config.voice.voiceType }}
              onSave={() => saveVoiceConfig(config.voice)}
              onTested={setVoiceStatus}
            />
            <ConnectionStatusBar result={voiceStatus} />
          </section>
        </div>
      </div>
    </>
  )
}
