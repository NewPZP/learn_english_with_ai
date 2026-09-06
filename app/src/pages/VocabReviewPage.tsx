import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Rotate3d } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { RatingControls } from '../components/RatingControls'
import { routes } from '../routes'
import {
  listWordEntries,
  listPhraseEntries,
  aggregateLatestWordRecord,
  aggregateLatestPhraseRecord,
  type VocabEntry,
} from '../lib/vocabBook'
import {
  rateGlobalWord,
  rateGlobalPhrase,
  RATING_LABELS,
  MEMORY_CURVE_LABELS,
  type SelfRating,
  type WordProgressRecord,
} from '../lib/wordProgress'

const RATING_ORDER: SelfRating[] = ['unknown', 'fuzzy', 'known']

interface ReviewItem {
  entry: VocabEntry
  record: WordProgressRecord | undefined
}

/**
 * 翻卡式到期复习页：跨所有文章推送已到期（nextReviewAt <= now）的词/短语
 * 正面：词面 + 音标；翻面：中文释义 + 记忆曲线状态
 * 三档自评后同步写回所有来源文章，并进入下一张
 */
export function VocabReviewPage() {
  const { kind } = useParams<{ kind: 'words' | 'phrases' }>()
  const isWords = kind === 'words'
  const title = isWords ? '单词复习' : '短语复习'
  const backTo = isWords ? routes.vocabWords : routes.vocabPhrases

  const dueItems = useMemo<ReviewItem[]>(() => {
    const now = Date.now()
    const entries = isWords ? listWordEntries() : listPhraseEntries()
    return entries
      .map((entry) => ({
        entry,
        record: isWords ? aggregateLatestWordRecord(entry.text) : aggregateLatestPhraseRecord(entry.text),
      }))
      .filter((r) => r.record && new Date(r.record.nextReviewAt).getTime() <= now)
  }, [isWords])

  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [results, setResults] = useState<Record<SelfRating, number>>({ unknown: 0, fuzzy: 0, known: 0 })

  const total = dueItems.length
  const current = dueItems[index]
  const finished = index >= total

  const handleRate = (rating: SelfRating) => {
    if (!current) return
    if (isWords) rateGlobalWord(current.entry.text, current.entry.sourceArticleIds, rating)
    else rateGlobalPhrase(current.entry.text, current.entry.sourceArticleIds, rating)
    setResults((prev) => ({ ...prev, [rating]: prev[rating] + 1 }))
    setFlipped(false)
    setIndex((i) => i + 1)
  }

  if (total === 0) {
    return (
      <>
        <PageTopbar title={title} backTo={backTo} backLabel="返回生词本" />
        <div className="app-content-inner">
          <div className="empty-state" data-testid="review-empty">
            <Check size={32} />
            <span className="empty-state-title">没有到期需要复习的内容</span>
            <span className="empty-state-hint">所有词都还在记忆周期内，过几天再来看看</span>
            <Link to={backTo} className="function-btn function-btn-primary">
              返回{isWords ? '生词本' : '短语本'}
            </Link>
          </div>
        </div>
      </>
    )
  }

  if (finished) {
    return (
      <>
        <PageTopbar title={title} backTo={backTo} backLabel="返回生词本" />
        <div className="app-content-inner">
          <div className="flashcard completion-card" data-testid="review-completion">
            <div className="flashcard-front-body">
              <h2 className="flashcard-word">复习完成！</h2>
              <p className="flashcard-phonetic">本轮共复习 {total} 项</p>
              <div className="review-result-stats">
                {RATING_ORDER.map((r) => (
                  <span key={r} className={`review-result-item rating-${r}`}>
                    {RATING_LABELS[r]} {results[r]}
                  </span>
                ))}
              </div>
              <Link to={backTo} className="function-btn function-btn-primary">
                返回{isWords ? '生词本' : '短语本'}
              </Link>
            </div>
          </div>
        </div>
      </>
    )
  }

  const { entry, record } = current

  return (
    <>
      <PageTopbar
        title={title}
        backTo={backTo}
        backLabel="返回生词本"
        right={
          <span className="topbar-progress nums" data-testid="review-progress">
            {index + 1} / {total}
          </span>
        }
      />
      <div className="app-content-inner">
        <div className="wp-left-col review-col">
          <div
            role="button"
            tabIndex={0}
            aria-label={`闪卡：${entry.text}，点击${flipped ? '查看正面' : '查看释义'}`}
            onClick={() => setFlipped((f) => !f)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setFlipped((f) => !f)
            }}
            data-testid="review-flashcard"
          >
            {flipped ? (
              <div className="flashcard flashcard-back" data-testid="review-back">
                <dl className="flashcard-back-body">
                  <div>
                    <dt>翻译</dt>
                    <dd className="flashcard-translation">{entry.translation}</dd>
                  </div>
                  {record && (
                    <div>
                      <dt>掌握程度</dt>
                      <dd>
                        <span className={`vocab-rating-tag rating-${record.rating}`}>
                          {RATING_LABELS[record.rating]}
                        </span>
                        <span className="vocab-stage">
                          第 {record.stage + 1} / {MEMORY_CURVE_LABELS.length} 档
                        </span>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            ) : (
              <div className="flashcard" data-testid="review-front">
                <div className="flashcard-front-body">
                  <h2 className="flashcard-word">{entry.text}</h2>
                  {entry.phonetic && <p className="flashcard-phonetic">{entry.phonetic}</p>}
                  <div className="flashcard-hint">
                    <Rotate3d size={14} />
                    <span>点击卡片查看释义</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <RatingControls
            onRate={handleRate}
            domIdPrefix="review"
            testIdPrefix="review-rate"
          />
        </div>
      </div>
    </>
  )
}
