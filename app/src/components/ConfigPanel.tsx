import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, Activity, Check, Loader2 } from 'lucide-react'
import {
  testConnection,
  type ConnectionTestResult,
  type ModelEndpoint,
  type ProviderMode,
} from '../lib/aiConfig'

/* ---- 小控件 ---- */

export function FieldLabel({ children, optional, htmlFor }: { children: ReactNode; optional?: boolean; htmlFor?: string }) {
  return (
    <label className="form-label" htmlFor={htmlFor}>
      {children}
      {optional && <span className="optional">（可选）</span>}
    </label>
  )
}

/** API Key 输入：默认密文，眼睛图标切换明文 */
export function ApiKeyInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (v: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="input-wrapper">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className="form-input password"
        value={value}
        placeholder="输入 API Key"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="toggle-btn"
        aria-label={visible ? '隐藏 API Key' : '显示 API Key'}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

/** 文本输入字段组 */
export function TextField({
  id,
  label,
  optional,
  placeholder,
  value,
  onChange,
}: {
  id: string
  label: string
  optional?: boolean
  placeholder?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="form-group">
      <FieldLabel htmlFor={id} optional={optional}>{label}</FieldLabel>
      <input
        id={id}
        type="text"
        className="form-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/**
 * 两面板共享的端点字段组：API Key + Base URL + 模型名称
 * id 以 prefix 区分（text- / voice-）
 */
export function EndpointFields({
  prefix,
  modelPlaceholder,
  endpoint,
  onChange,
}: {
  prefix: string
  modelPlaceholder: string
  endpoint: ModelEndpoint
  onChange: (patch: Partial<ModelEndpoint>) => void
}) {
  return (
    <>
      <div className="form-group">
        <FieldLabel htmlFor={`${prefix}api-key`}>API Key</FieldLabel>
        <ApiKeyInput
          id={`${prefix}api-key`}
          value={endpoint.apiKey}
          onChange={(apiKey) => onChange({ apiKey })}
        />
      </div>
      <TextField
        id={`${prefix}base-url`}
        label="Base URL"
        optional
        placeholder="https://api.openai.com/v1"
        value={endpoint.baseUrl}
        onChange={(baseUrl) => onChange({ baseUrl })}
      />
      <TextField
        id={`${prefix}model-name`}
        label="模型名称"
        placeholder={modelPlaceholder}
        value={endpoint.modelName}
        onChange={(modelName) => onChange({ modelName })}
      />
    </>
  )
}

/** 滑块行：标签 + 实时数值（如 0.7 / 1.2x） */
export function RangeField({
  id,
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
}: {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="form-group">
      <div className="range-row">
        <label className="form-label" htmlFor={id}>{label}</label>
        <span className="range-value" data-testid={`${id}-value`}>{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

/* ---- 测试连接 + 保存 + 状态条 ---- */

interface PanelActionsProps {
  testId: string
  saveId: string
  endpoint: Pick<ModelEndpoint, 'apiKey' | 'baseUrl'>
  mode: ProviderMode
  onSave: () => void
  onTested: (result: ConnectionTestResult) => void
}

export function PanelActions({ testId, saveId, endpoint, mode, onSave, onTested }: PanelActionsProps) {
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    try {
      const result = await testConnection(endpoint, mode)
      onTested(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="config-actions">
      <button
        type="button"
        id={testId}
        className="btn"
        onClick={handleTest}
        disabled={testing}
      >
        {testing ? (
          <Loader2 size={18} className="spin" />
        ) : (
          <Activity size={18} />
        )}
        <span>{testing ? '测试中...' : '测试连接'}</span>
      </button>
      <button type="button" id={saveId} className="btn btn-primary" onClick={onSave}>
        <Check size={18} />
        <span>保存配置</span>
      </button>
    </div>
  )
}

/** 连接状态条：未测试（warn）/ 连接正常（ok）/ 失败（error），均显示延迟 */
export function ConnectionStatusBar({ result }: { result: ConnectionTestResult | null }) {
  const state = !result
    ? { cls: 'warn', message: '尚未测试连接', detail: '点击「测试连接」验证配置' }
    : result.ok
      ? { cls: 'ok', message: '连接正常', detail: `延迟 ${result.latencyMs}ms` }
      : { cls: 'error', message: '连接失败', detail: `${result.message}（延迟 ${result.latencyMs}ms）` }

  return (
    <div className={`connection-status ${state.cls}`}>
      <span className={`status-dot ${state.cls}`} />
      <span className="status-message">{state.message}</span>
      <span className="status-detail">{state.detail}</span>
    </div>
  )
}

/** 面板头徽章：已连接 / 未连接 */
export function ConfigBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`config-badge ${connected ? 'connected' : 'disconnected'}`}>
      {connected ? <Check size={12} /> : null}
      {connected ? '已连接' : '未连接'}
    </span>
  )
}
