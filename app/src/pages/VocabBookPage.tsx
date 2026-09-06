import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Play,
  Trash2,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { RatingControls } from '../components/RatingControls'
import { routes } from '../routes'
import { getArticle } from '../lib/articles'
import {
  listWordEntries,
  listPhraseEntries,
  aggregateLatestWordRecord,
  aggregateLatestPhraseRecord,
  removeWordEntry,
  removePhraseEntry,
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

type VocabKind = 'words' | 'phrases'

const RATING_ORDER: SelfRating[] = ['unknown', 'fuzzy', 'known']

type SortKey = 'collected' | 'mastery' | 'alpha'
type FilterRating = SelfRating | 'all'

interface VocabRow {
  entry: VocabEntry
  record: WordProgressRecord | undefined
}

/**
 * 生词本 / 短语本列表页（按 kind 复用）
 * - 跨文章汇总收录条目，掌握程度取各来源最新自评
 * - 支持按掌握度筛选、排序、行内自评（同步写回所有来源）、移除
 * - 顶部「开始复习」入口（有到期词时可用）
 */
export function VocabBookPage({ kind }: { kind: VocabKind }) {
  const isWords = kind === 'words'
  const title = isWords ? '生词本' : '短语本'
  const [filter, setFilter] = useState<FilterRating>('all')
  const [sortKey, setSortKey] = useState<SortKey>('collected')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** 版本号：自评/移除后自增以触发重新读取 localStorage */
  const [version, setVersion] = useState(0)

  const rows: VocabRow[] = useMemo(() => {
    const entries = isWords ? listWordEntries() : listPhraseEntries()
    return entries.map((entry) => ({
      entry,
      record: isWords ? aggregateLatestWordRecord(entry.text) : aggregateLatestPhraseRecord(entry.text),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, version])

  const filtered = useMemo(() => {
    let list = rows
    if (filter !== 'all') {
      list = list.filter((r) => r.record?.rating === filter)
    }
    const sorted = [...list]
    if (sortKey === 'collected') {
      sorted.sort((a, b) => b.entry.collectedAt.localeCompare(a.entry.collectedAt))
    } else if (sortKey === 'alpha') {
      sorted.sort((a, b) => a.entry.text.localeCompare(b.entry.text))
    } else {
      // mastery 升序：未评 < 不认识 < 模糊 < 认识；同档按 stage 升序
      const rank = (r: VocabRow): number => {
        if (!r.record) return 0
        const ratingRank = r.record.rating === 'unknown' ? 1 : r.record.rating === 'fuzzy' ? 2 : 3
        return ratingRank * 10 + r.record.stage
      }
      sorted.sort((a, b) => rank(a) - rank(b))
    }
    return sorted
  }, [rows, filter, sortKey])

  const dueCount = useMemo(
    () => rows.filter((r) => r.record && new Date(r.record.nextReviewAt).getTime() <= Date.now()).length,
    [rows],
  )

  const handleRate = (entry: VocabEntry, rating: SelfRating) => {
    if (isWords) rateGlobalWord(entry.text, entry.sourceArticleIds, rating)
    else rateGlobalPhrase(entry.text, entry.sourceArticleIds, rating)
    setVersion((v) => v + 1)
  }

  const handleRemove = (entry: VocabEntry) => {
    if (isWords) removeWordEntry(entry.text)
    else removePhraseEntry(entry.text)
    setVersion((v) => v + 1)
  }

  const toggleExpand = (text: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(text)) next.delete(text)
      else next.add(text)
      return next
    })
  }

  return (
    <>
      <PageTopbar
        title={title}
        right={
          dueCount > 0 ? (
            <Link
              to={routes.vocabReview(kind)}
              className="function-btn function-btn-primary"
              data-dom-id={`cta-review-${kind}`}
            >
              <Play size={16} />
              <span>开始复习 ({dueCount})</span>
            </Link>
          ) : (
            <span className="topbar-count nums">共 {rows.length} 项</span>
          )
        }
      />
      <div className="app-content-inner">
        {/* 筛选 + 排序工具栏 */}
        <div className="vocab-toolbar" data-testid="vocab-toolbar">
          <div className="vocab-filters" role="group" aria-label="按掌握度筛选">
            {(['all', ...RATING_ORDER] as FilterRating[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`vocab-filter-btn ${filter === f ? 'is-active' : ''}`}
                data-testid={`filter-${f}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '全部' : RATING_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="vocab-sort">
            <label htmlFor="vocab-sort-select">排序</label>
            <select
              id="vocab-sort-select"
              value={sortKey}
              data-testid="vocab-sort"
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="collected">收录时间</option>
              <option value="mastery">掌握程度</option>
              <option value="alpha">字母序</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state" data-testid="vocab-empty">
            <BookOpen size={32} />
            <span className="empty-state-title">
              {rows.length === 0 ? `${title}还是空的` : '没有符合条件的条目'}
            </span>
            <span className="empty-state-hint">
              {rows.length === 0
                ? '在词汇预习页点击 ⭐ 把生词加入这里'
                : '试试切换筛选条件'}
            </span>
          </div>
        ) : (
          <ul className="vocab-list" data-testid="vocab-list">
            {filtered.map(({ entry, record }) => {
              const isExpanded = expanded.has(entry.text)
              return (
                <li key={entry.text} className="vocab-item" data-testid={`vocab-item-${entry.text}`}>
                  <div className="vocab-item-main">
                    <div className="vocab-item-head">
                      <span className="vocab-item-text">{entry.text}</span>
                      {entry.phonetic && <span className="vocab-item-phonetic">{entry.phonetic}</span>}
                      {entry.partOfSpeech && (
                        <span className="vocab-item-pos">{entry.partOfSpeech}</span>
                      )}
                    </div>
                    <div className="vocab-item-translation">{entry.translation}</div>
                    <div className="vocab-item-meta">
                      <span className="vocab-mastery" data-testid={`mastery-${entry.text}`}>
                        {record ? (
                          <>
                            <span className={`vocab-rating-tag rating-${record.rating}`}>
                              {RATING_LABELS[record.rating]}
                            </span>
                            <span className="vocab-stage">
                              第 {record.stage + 1} / {MEMORY_CURVE_LABELS.length} 档
                            </span>
                          </>
                        ) : (
                          <span className="vocab-rating-tag rating-unrated">未评</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="vocab-source-toggle"
                        data-testid={`source-toggle-${entry.text}`}
                        onClick={() => toggleExpand(entry.text)}
                      >
                        来自 {entry.sourceArticleIds.length} 篇
                        <ChevronDown size={14} className={isExpanded ? 'is-open' : ''} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <ul className="vocab-source-list" data-testid={`source-list-${entry.text}`}>
                      {entry.sourceArticleIds.map((aid) => {
                        const article = getArticle(aid)
                        return (
                          <li key={aid}>
                            <Link to={routes.articleWords(aid)}>
                              {article?.title ?? `文章 #${aid}`}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="vocab-item-actions">
                    <RatingControls
                      onRate={(rating) => handleRate(entry, rating)}
                      domIdPrefix={`vocab-${entry.text}`}
                      testIdPrefix={`rate-${entry.text}`}
                      size={14}
                    />
                    <button
                      type="button"
                      className="icon-btn vocab-remove-btn"
                      aria-label="移出生词本"
                      data-dom-id={`cta-remove-${entry.text}`}
                      data-testid={`remove-${entry.text}`}
                      onClick={() => handleRemove(entry)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
