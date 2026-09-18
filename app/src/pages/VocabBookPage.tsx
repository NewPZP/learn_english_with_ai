import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CheckSquare,
  ChevronDown,
  Play,
  Square,
  Trash2,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { FamiliarityHearts } from '../components/FamiliarityHearts'
import { routes } from '../routes'
import { getArticle } from '../lib/articles'
import {
  listWordEntries,
  listPhraseEntries,
  aggregateLatestWordRecord,
  aggregateLatestPhraseRecord,
  removeWordEntry,
  removePhraseEntry,
  familiarityOf,
  setWordFamiliarity,
  setPhraseFamiliarity,
  type VocabEntry,
} from '../lib/vocabBook'
import {
  MAX_FAMILIARITY,
  MEMORY_CURVE_LABELS,
  type WordProgressRecord,
} from '../lib/wordProgress'

type VocabKind = 'words' | 'phrases'

type SortKey = 'collected' | 'mastery' | 'alpha'
/** 熟悉程度筛选：全部 / 未评(0) / 1-5 心 */
type FamiliarityFilter = 'all' | number

interface VocabRow {
  entry: VocabEntry
  record: WordProgressRecord | undefined
  /** 熟悉程度 0-5 心（手动覆盖优先，否则算法计算） */
  familiarity: number
}

/**
 * 生词页（合并单词/短语）
 * - 页面内切换「单词 / 短语」
 * - 每个词条的熟悉程度为 5 颗心：由学习历史算法计算，也可点心手动设置
 * - 支持按熟悉程度筛选（下拉）、排序、移除
 * - 顶栏紧凑复习入口（始终可进入）
 * - 批量勾选条目后「复习选中」
 */
export function VocabBookPage() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<VocabKind>('words')
  const isWords = kind === 'words'
  const title = '生词'

  const [filter, setFilter] = useState<FamiliarityFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('collected')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** 版本号：熟悉程度设置/移除后自增以触发重新读取 localStorage */
  const [version, setVersion] = useState(0)

  const rows: VocabRow[] = useMemo(() => {
    const entries = isWords ? listWordEntries() : listPhraseEntries()
    return entries.map((entry) => {
      const record = isWords
        ? aggregateLatestWordRecord(entry.text)
        : aggregateLatestPhraseRecord(entry.text)
      return { entry, record, familiarity: familiarityOf(entry, record) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, version])

  const filtered = useMemo(() => {
    let list = rows
    if (filter !== 'all') {
      list = list.filter((r) => r.familiarity === filter)
    }
    const sorted = [...list]
    if (sortKey === 'collected') {
      sorted.sort((a, b) => b.entry.collectedAt.localeCompare(a.entry.collectedAt))
    } else if (sortKey === 'alpha') {
      sorted.sort((a, b) => a.entry.text.localeCompare(b.entry.text))
    } else {
      // mastery 升序：心数少在前；同心数按记忆曲线 stage 升序
      const rank = (r: VocabRow): number => r.familiarity * 10 + (r.record?.stage ?? 0)
      sorted.sort((a, b) => rank(a) - rank(b))
    }
    return sorted
  }, [rows, filter, sortKey])

  const dueCount = useMemo(
    () => rows.filter((r) => r.record && new Date(r.record.nextReviewAt).getTime() <= Date.now()).length,
    [rows],
  )

  /** 设置熟悉程度：1-5 心为手动覆盖值，0 清除覆盖恢复算法值 */
  const handleSetFamiliarity = (entry: VocabEntry, value: number) => {
    const familiarity = value === 0 ? null : value
    if (isWords) setWordFamiliarity(entry.text, familiarity)
    else setPhraseFamiliarity(entry.text, familiarity)
    setVersion((v) => v + 1)
  }

  const handleRemove = (entry: VocabEntry) => {
    if (isWords) removeWordEntry(entry.text)
    else removePhraseEntry(entry.text)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(entry.text)
      return next
    })
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

  const toggleSelect = (text: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(text)) next.delete(text)
      else next.add(text)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((r) => r.entry.text)))
    }
  }

  const handleReviewSelected = () => {
    const texts = Array.from(selected)
    navigate(routes.vocabReview(kind), { state: { mode: 'selected', texts } })
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length

  return (
    <>
      <PageTopbar
        title={title}
        right={
          <Link
            to={routes.vocabReview(kind)}
            className="vocab-review-entry"
            data-dom-id={`cta-review-${kind}`}
          >
            <Play size={16} />
            {dueCount > 0 && <span className="vocab-review-badge">{dueCount}</span>}
            <span>复习</span>
          </Link>
        }
      />
      <div className="app-content-inner">
        {/* 类型切换 + 工具栏 */}
        <div className="vocab-toolbar" data-testid="vocab-toolbar">
          <div className="vocab-kind-switch" role="group" aria-label="类型">
            {(['words', 'phrases'] as VocabKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`vocab-kind-btn ${kind === k ? 'is-active' : ''}`}
                data-testid={`kind-${k}`}
                onClick={() => {
                  setKind(k)
                  setSelected(new Set())
                  setExpanded(new Set())
                }}
              >
                {k === 'words' ? '单词' : '短语'}
              </button>
            ))}
          </div>
          <div className="vocab-toolbar-right">
            <div className="vocab-filter">
              <label htmlFor="vocab-filter-select">熟悉度</label>
              <select
                id="vocab-filter-select"
                value={filter === 'all' ? 'all' : String(filter)}
                data-testid="vocab-filter"
                onChange={(e) =>
                  setFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
              >
                <option value="all">全部</option>
                <option value="0">未评</option>
                {Array.from({ length: MAX_FAMILIARITY }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {'❤'.repeat(n)}
                  </option>
                ))}
              </select>
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
        </div>

        {/* 批量操作栏 */}
        {rows.length > 0 && (
          <div className="vocab-batch-bar" data-testid="vocab-batch-bar">
            <button
              type="button"
              className="vocab-select-all"
              data-testid="select-all"
              onClick={toggleSelectAll}
            >
              {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              <span>全选</span>
            </button>
            <span className="vocab-selected-count" data-testid="selected-count">
              已选 {selected.size} / {filtered.length}
            </span>
            <button
              type="button"
              className="function-btn function-btn-primary vocab-review-selected-btn"
              data-dom-id="cta-review-selected"
              data-testid="review-selected"
              disabled={selected.size === 0}
              onClick={handleReviewSelected}
            >
              <Play size={14} />
              <span>复习选中 ({selected.size})</span>
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="empty-state" data-testid="vocab-empty">
            <BookOpen size={32} />
            <span className="empty-state-title">
              {rows.length === 0 ? `${isWords ? '单词' : '短语'}列表还是空的` : '没有符合条件的条目'}
            </span>
            <span className="empty-state-hint">
              {rows.length === 0
                ? '在词汇预习页点击 ⭐ 把生词加入这里'
                : '试试切换筛选条件'}
            </span>
          </div>
        ) : (
          <ul className="vocab-list" data-testid="vocab-list">
            {filtered.map(({ entry, record, familiarity }) => {
              const isExpanded = expanded.has(entry.text)
              const isSelected = selected.has(entry.text)
              return (
                <li
                  key={entry.text}
                  className={`vocab-item ${isSelected ? 'is-selected' : ''}`}
                  data-testid={`vocab-item-${entry.text}`}
                >
                  <button
                    type="button"
                    className="vocab-checkbox"
                    aria-label={isSelected ? '取消选择' : '选择'}
                    data-testid={`checkbox-${entry.text}`}
                    data-checked={isSelected}
                    onClick={() => toggleSelect(entry.text)}
                  >
                    {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>

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
                          <span className="vocab-stage">
                            第 {record.stage + 1} / {MEMORY_CURVE_LABELS.length} 档
                          </span>
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

                  <div className="vocab-item-side">
                    <FamiliarityHearts
                      value={familiarity}
                      onChange={(value) => handleSetFamiliarity(entry, value)}
                      testIdPrefix={`hearts-${entry.text}`}
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
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
