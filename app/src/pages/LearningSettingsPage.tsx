import { useState } from 'react'
import { BookmarkPlus, Check } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { setAutoCollectRatings, loadSettings, type LearningSettings } from '../lib/settings'
import { RATING_LABELS, type SelfRating } from '../lib/wordProgress'

const RATING_ORDER: SelfRating[] = ['unknown', 'fuzzy', 'known']

/**
 * 学习设置页：当前仅「自动收录档位」开关
 * 命中档位的自评会自动把词收入生词本；空选 = 关闭自动收录
 */
export function LearningSettingsPage() {
  const [settings, setSettings] = useState<LearningSettings>(() => loadSettings())

  const toggleRating = (rating: SelfRating) => {
    const next = settings.autoCollectRatings.includes(rating)
      ? settings.autoCollectRatings.filter((r) => r !== rating)
      : [...settings.autoCollectRatings, rating]
    const updated = setAutoCollectRatings(next)
    setSettings(updated)
  }

  const enabled = settings.autoCollectRatings.length > 0

  return (
    <>
      <PageTopbar title="学习设置" />
      <div className="app-content-inner">
        <section className="section-card settings-section" data-testid="auto-collect-section">
          <div className="settings-section-header">
            <BookmarkPlus size={20} />
            <div>
              <h2 className="settings-section-title">自动收录生词</h2>
              <p className="settings-section-desc">
                在词汇预习中评为以下档位的词，将自动收入对应的生词本/短语本。
              </p>
            </div>
          </div>

          <div className="settings-toggle-row">
            <span className="settings-toggle-label">自动收录</span>
            <span className={`settings-switch ${enabled ? 'is-on' : ''}`} data-testid="auto-collect-switch">
              {enabled ? '已开启' : '已关闭'}
            </span>
          </div>

          <div className="settings-checkboxes" role="group" aria-label="自动收录档位">
            {RATING_ORDER.map((rating) => {
              const checked = settings.autoCollectRatings.includes(rating)
              return (
                <button
                  key={rating}
                  type="button"
                  className={`settings-checkbox ${checked ? 'is-checked' : ''}`}
                  data-dom-id={`cta-auto-collect-${rating}`}
                  data-testid={`auto-collect-${rating}`}
                  data-checked={checked}
                  onClick={() => toggleRating(rating)}
                >
                  <span className="checkbox-box">
                    {checked && <Check size={14} />}
                  </span>
                  <span>{RATING_LABELS[rating]}</span>
                </button>
              )
            })}
          </div>

          {!enabled && (
            <p className="settings-hint" data-testid="auto-collect-hint">
              当前关闭自动收录，可在词汇预习页手动点击 ⭐ 加入生词本。
            </p>
          )}
        </section>
      </div>
    </>
  )
}
