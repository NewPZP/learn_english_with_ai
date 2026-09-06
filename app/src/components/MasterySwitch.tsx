import { useState } from 'react'
import { Check, Minus, X } from 'lucide-react'
import type { SelfRating } from '../lib/wordProgress'

/** 三档自评顺序（全应用唯一来源） */
export const RATING_ORDER: SelfRating[] = ['unknown', 'fuzzy', 'known']

const RATING_META: Record<SelfRating, { icon: typeof X; label: string }> = {
  unknown: { icon: X, label: '不认识' },
  fuzzy: { icon: Minus, label: '模糊' },
  known: { icon: Check, label: '认识' },
}

interface MasterySwitchProps {
  value?: SelfRating
  onChange: (rating: SelfRating) => void
  /** data-dom-id 前缀，生成 cta-rate-${prefix}-${rating} */
  domIdPrefix?: string
  /** data-testid 前缀，生成 ${prefix}-${rating} */
  testIdPrefix?: string
  size?: number
  disabled?: boolean
  /** 是否在按钮内显示档位文字标签（复习页用） */
  showLabel?: boolean
}

/**
 * 多档开关自评控件：不认识 / 模糊 / 认识
 * 类似分段控件（Segmented Control），hover 或激活时显示当前档位 tooltip
 * 用于生词本列表行内、复习页翻卡底部
 */
export function MasterySwitch({
  value,
  onChange,
  domIdPrefix,
  testIdPrefix = 'mastery',
  size = 14,
  disabled,
  showLabel = false,
}: MasterySwitchProps) {
  const [hovered, setHovered] = useState<SelfRating | null>(null)

  return (
    <div className={`mastery-switch ${showLabel ? 'is-labeled' : ''}`} data-testid={testIdPrefix}>
      {RATING_ORDER.map((rating) => {
        const meta = RATING_META[rating]
        const Icon = meta.icon
        const isActive = value === rating
        const isHovered = hovered === rating
        const showTooltip = (isActive || isHovered) && !showLabel
        return (
          <button
            key={rating}
            type="button"
            className={`mastery-segment mastery-${rating} ${isActive ? 'is-active' : ''}`}
            data-dom-id={domIdPrefix ? `cta-rate-${domIdPrefix}-${rating}` : `cta-rate-${rating}`}
            data-testid={`${testIdPrefix}-${rating}`}
            data-rating={rating}
            data-rating-label={meta.label}
            onClick={() => onChange(rating)}
            onMouseEnter={() => setHovered(rating)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(rating)}
            onBlur={() => setHovered(null)}
            disabled={disabled}
            aria-label={meta.label}
            aria-pressed={isActive}
          >
            <Icon size={size} />
            {showLabel && <span className="mastery-segment-label">{meta.label}</span>}
            {showTooltip && (
              <span className="mastery-tooltip" role="tooltip">
                {meta.label}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
