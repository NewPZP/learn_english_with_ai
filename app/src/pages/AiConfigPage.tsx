import { useState } from 'react'
import { Type, AudioLines } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import {
  ApiKeyInput,
  ConfigBadge,
  ConnectionStatusBar,
  FieldLabel,
  PanelActions,
  RangeField,
} from '../components/ConfigPanel'
import {
  loadAiConfig,
  saveTextConfig,
  saveVoiceConfig,
  type AiConfig,
  type AudioFormat,
  type ConnectionTestResult,
  type VoiceType,
} from '../lib/aiConfig'

const VOICE_TYPES: { value: VoiceType; label: string }[] = [
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

/**
 * AI 配置页：文字/声音模型双面板
 * 每面板独立测试连接（mock 延迟）与保存（localStorage 持久化）
 */
export function AiConfigPage() {
  const [config, setConfig] = useState<AiConfig>(() => loadAiConfig())
  const [textStatus, setTextStatus] = useState<ConnectionTestResult | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<ConnectionTestResult | null>(null)

  const updateText = (patch: Partial<AiConfig['text']>) =>
    setConfig((c) => ({ ...c, text: { ...c.text, ...patch } }))
  const updateVoice = (patch: Partial<AiConfig['voice']>) =>
    setConfig((c) => ({ ...c, voice: { ...c.voice, ...patch } }))

  return (
    <>
      <PageTopbar title="AI 配置" />
      <div className="app-content-inner">
        <div className="ai-config-container">
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

            <div className="form-group">
              <FieldLabel htmlFor="text-api-key">API Key</FieldLabel>
              <ApiKeyInput
                id="text-api-key"
                value={config.text.apiKey}
                onChange={(apiKey) => updateText({ apiKey })}
              />
            </div>

            <div className="form-group">
              <FieldLabel htmlFor="text-base-url" optional>Base URL</FieldLabel>
              <input
                id="text-base-url"
                type="text"
                className="form-input"
                placeholder="https://api.openai.com/v1"
                value={config.text.baseUrl}
                onChange={(e) => updateText({ baseUrl: e.target.value })}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <FieldLabel htmlFor="text-model-name">模型名称</FieldLabel>
                <input
                  id="text-model-name"
                  type="text"
                  className="form-input"
                  placeholder="gpt-4o"
                  value={config.text.modelName}
                  onChange={(e) => updateText({ modelName: e.target.value })}
                />
              </div>
              <div className="form-group">
                <FieldLabel htmlFor="text-max-tokens">Max Tokens</FieldLabel>
                <input
                  id="text-max-tokens"
                  type="number"
                  className="form-input"
                  min={1}
                  max={128000}
                  value={config.text.maxTokens}
                  onChange={(e) => updateText({ maxTokens: parseInt(e.target.value || '0', 10) })}
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
              apiKey={config.text.apiKey}
              baseUrl={config.text.baseUrl}
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

            <div className="form-group">
              <FieldLabel htmlFor="voice-api-key">API Key</FieldLabel>
              <ApiKeyInput
                id="voice-api-key"
                value={config.voice.apiKey}
                onChange={(apiKey) => updateVoice({ apiKey })}
              />
            </div>

            <div className="form-group">
              <FieldLabel htmlFor="voice-base-url" optional>Base URL</FieldLabel>
              <input
                id="voice-base-url"
                type="text"
                className="form-input"
                placeholder="https://api.openai.com/v1"
                value={config.voice.baseUrl}
                onChange={(e) => updateVoice({ baseUrl: e.target.value })}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <FieldLabel htmlFor="voice-model-name">模型名称</FieldLabel>
                <input
                  id="voice-model-name"
                  type="text"
                  className="form-input"
                  placeholder="tts-1"
                  value={config.voice.modelName}
                  onChange={(e) => updateVoice({ modelName: e.target.value })}
                />
              </div>
              <div className="form-group">
                <FieldLabel htmlFor="voice-type">语音类型</FieldLabel>
                <select
                  id="voice-type"
                  className="form-select"
                  value={config.voice.voiceType}
                  onChange={(e) => updateVoice({ voiceType: e.target.value as VoiceType })}
                >
                  {VOICE_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <FieldLabel htmlFor="audio-format">音频格式</FieldLabel>
                <select
                  id="audio-format"
                  className="form-select"
                  value={config.voice.audioFormat}
                  onChange={(e) => updateVoice({ audioFormat: e.target.value as AudioFormat })}
                >
                  {AUDIO_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
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
            </div>

            <PanelActions
              testId="voice-test-btn"
              saveId="voice-save-btn"
              apiKey={config.voice.apiKey}
              baseUrl={config.voice.baseUrl}
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
