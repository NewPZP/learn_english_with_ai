import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, Activity, Check, Loader2 } from 'lucide-react'
import {
  testConnection,
  type ConnectionTestResult,
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
  apiKey: string
  baseUrl: string
  onSave: () => void
  onTested: (result: ConnectionTestResult) => void
}

export function PanelActions({ testId, saveId, apiKey, baseUrl, onSave, onTested }: PanelActionsProps) {
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    try {
      const result = await testConnection({ apiKey, baseUrl })
      onTested(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
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
    </>
  )
}

/** 连接状态条：未配置（warn）/ 连接正常（ok）/ 失败（error） */
export function ConnectionStatusBar({ result }: { result: ConnectionTestResult | null }) {
  if (!result) {
    return (
      <div className="connection-status warn">
        <span className="status-dot warn" />
        <span className="status-message">尚未测试连接</span>
        <span className="status-detail">点击「测试连接」验证配置</span>
      </div>
    )
  }
  if (!result.ok) {
    return (
      <div className="connection-status error">
        <span className="status-dot error" />
        <span className="status-message">连接失败</span>
        <span className="status-detail">{result.message}</span>
      </div>
    )
  }
  return (
    <div className="connection-status ok">
      <span className="status-dot ok" />
      <span className="status-message">连接正常</span>
      <span className="status-detail">延迟 {result.latencyMs}ms</span>
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
