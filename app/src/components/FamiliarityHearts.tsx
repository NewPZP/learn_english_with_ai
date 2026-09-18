import { Heart } from 'lucide-react'
import { MAX_FAMILIARITY } from '../lib/wordProgress'

interface FamiliarityHeartsProps {
  /** 当前熟悉程度 0-5（0 = 未评/空心） */
  value: number
  /** 点击心设置：1-5 为新值，0 表示清除覆盖（恢复算法值） */
  onChange?: (value: number) => void
  /** data-testid 前缀，生成 ${prefix}-${n} */
  testIdPrefix?: string
}

/**
 * 熟悉程度 5 颗心控件：展示 + 可点选设置
 * 点击第 n 颗心设为 n 心；点击当前值对应的最后一颗心清零（清除手动覆盖）
 */
export function FamiliarityHearts({
  value,
  onChange,
  testIdPrefix = 'hearts',
}: FamiliarityHeartsProps) {
  return (
    <div
      className="familiarity-hearts"
      role="group"
      aria-label={`熟悉程度 ${value === 0 ? '未评' : `${value} / ${MAX_FAMILIARITY} 心`}`}
      data-testid={testIdPrefix}
    >
      {Array.from({ length: MAX_FAMILIARITY }, (_, i) => i + 1).map((n) => {
        const isFilled = n <= value
        return (
          <button
            key={n}
            type="button"
            className={`familiarity-heart ${isFilled ? 'is-filled' : ''}`}
            aria-label={isFilled && n === value ? `清除为 ${n} 心` : `设为 ${n} 心`}
            data-dom-id={`cta-familiarity-${testIdPrefix}-${n}`}
            data-testid={`${testIdPrefix}-${n}`}
            data-filled={isFilled}
            onClick={() => onChange?.(n === value ? 0 : n)}
          >
            <Heart size={16} fill={isFilled ? 'currentColor' : 'none'} />
          </button>
        )
      })}
    </div>
  )
}
