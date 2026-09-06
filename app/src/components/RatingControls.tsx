import { Check, Minus, X } from 'lucide-react'
import { RATING_LABELS, type SelfRating } from '../lib/wordProgress'

/** 三档自评顺序与按钮元数据（全应用唯一来源，避免各页面重复定义） */
export const RATING_ORDER: SelfRating[] = ['unknown', 'fuzzy', 'known']

export const RATING_META: Record<SelfRating, { icon: typeof X; className: string }> = {
  unknown: { icon: X, className: 'rate-unknown' },
  fuzzy: { icon: Minus, className: 'rate-fuzzy' },
  known: { icon: Check, className: 'rate-known' },
}

interface RatingControlsProps {
  onRate: (rating: SelfRating) => void
  disabled?: boolean
  /** data-dom-id 前缀，生成 cta-rate-${prefix}-${rating}；省略时为 cta-rate-${rating} */
  domIdPrefix?: string
  /** data-testid 前缀，生成 ${prefix}-${rating}；省略时为 rate-${rating} */
  testIdPrefix?: string
  size?: number
}

/**
 * 三档自评按钮组：不认识 / 模糊 / 认识
 * 词汇预习、生词本、复习模式共用；通过 domIdPrefix/testIdPrefix 区分交互锚点
 */
export function RatingControls({
  onRate,
  disabled,
  domIdPrefix,
  testIdPrefix = 'rate',
  size = 16,
}: RatingControlsProps) {
  return (
    <div className="repetition-controls">
      {RATING_ORDER.map((rating) => {
        const Icon = RATING_META[rating].icon
        return (
          <button
            key={rating}
            type="button"
            className={`repetition-btn ${RATING_META[rating].className}`}
            data-dom-id={domIdPrefix ? `cta-rate-${domIdPrefix}-${rating}` : `cta-rate-${rating}`}
            data-testid={`${testIdPrefix}-${rating}`}
            onClick={() => onRate(rating)}
            disabled={disabled}
          >
            <Icon size={size} />
            <span>{RATING_LABELS[rating]}</span>
          </button>
        )
      })}
    </div>
  )
}
