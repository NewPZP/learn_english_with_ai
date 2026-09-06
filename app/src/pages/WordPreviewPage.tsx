import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BookOpen, Bookmark, BookmarkCheck, Check, Rotate3d, Sparkles } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { RatingControls } from '../components/RatingControls'
import { getArticle } from '../lib/articles'
import { routes } from '../routes'
import type { PhraseEntry, WordEntry } from '../lib/ai'
import {
  computeStats,
  curveNodeStatuses,
  loadWordProgress,
  loadPhraseProgress,
  rateWord,
  ratePhrase,
  MEMORY_CURVE_LABELS,
  MAX_STAGE,
  type CurveNodeStatus,
  type SelfRating,
  type WordProgressRecord,
} from '../lib/wordProgress'
import {
  addWordEntry,
  removeWordEntry,
  isWordCollected,
  addPhraseEntry,
  removePhraseEntry,
  isPhraseCollected,
} from '../lib/vocabBook'
import { loadSettings } from '../lib/settings'
import { useStudyTimeTracker } from '../lib/useStudyTimeTracker'

type LearnTab = 'words' | 'phrases'

const TAB_LABELS: Record<LearnTab, string> = {
  words: '单词',
  phrases: '短语',
}

/* ---- 记忆曲线几何（节点坐标与节点间贝塞尔路径，源自原型 word-preview.html） ---- */

const CURVE_NODES = [
  { x: 15, y: 25 },
  { x: 80, y: 48 },
  { x: 148, y: 68 },
  { x: 215, y: 82 },
  { x: 285, y: 88 },
] as const

/** 节点 i → i+1 的三次贝塞尔控制点 */
const CURVE_SEGMENTS = [
  'C 35 28, 58 42, 80 48',
  'C 105 53, 128 65, 148 68',
  'C 175 74, 195 79, 215 82',
  'C 240 85, 265 87, 285 88',
] as const

function pathUpTo(nodeIndex: number): string {
  const start = CURVE_NODES[0]
  const segments = CURVE_SEGMENTS.slice(0, nodeIndex)
  return `M ${start.x} ${start.y}${segments.length ? ` ${segments.join(' ')}` : ''}`
}

const FULL_CURVE_PATH = pathUpTo(MAX_STAGE)

/** 到期节点脉冲圈与填充色（提示应复习） */
const DUE_COLOR = 'var(--state-warning)'

/**
 * 记忆曲线：节点状态由调度记录推导（curveNodeStatuses）
 * 已完成（实心✓）/ 当前（脉冲）/ 到期（警示色脉冲）/ 待复习（空心）
 */
function MemoryCurve({ statuses }: { statuses: CurveNodeStatus[] }) {
  // 实线覆盖最前面的连续已完成节点（全 completed 时贯穿全程）
  const firstActive = statuses.findIndex((s) => s !== 'completed')
  const solidNodes = firstActive === -1 ? statuses.length : firstActive
  return (
    <section className="section-card" data-testid="memory-curve">
      <p className="curve-caption">记忆曲线</p>
      <svg viewBox="0 0 300 110" className="curve-svg" aria-label="艾宾浩斯记忆曲线" role="img">
        {/* 全程虚线打底 */}
        <path
          d={FULL_CURVE_PATH}
          fill="none"
          stroke="var(--en-border)"
          strokeWidth="2"
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
        {/* 已完成段实线覆盖 */}
        <path
          d={pathUpTo(solidNodes)}
          fill="none"
          stroke="var(--en-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {CURVE_NODES.map((node, i) => {
          const status = statuses[i]
          const due = status === 'due'
          return (
            <g
              key={MEMORY_CURVE_LABELS[i]}
              transform={`translate(${node.x}, ${node.y})`}
              data-testid={`curve-node-${i}`}
              data-status={status}
            >
              {(status === 'current' || due) && (
                <circle
                  className="pulse-ring"
                  r="7"
                  fill="none"
                  stroke={due ? DUE_COLOR : 'var(--en-primary)'}
                  strokeWidth="2"
                />
              )}
              <circle
                r="7"
                fill={status === 'upcoming' ? 'var(--en-card)' : due ? DUE_COLOR : 'var(--en-primary)'}
                stroke="var(--en-border)"
                strokeWidth={status === 'upcoming' ? 2 : 0}
              />
              {status === 'completed' && (
                <path
                  d="M -3 0 L -1 2 L 3 -2.5"
                  stroke="var(--en-primary-foreground)"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {due && (
                <text y="3.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--en-card)">
                  !
                </text>
              )}
              <text
                y={106 - node.y}
                textAnchor="middle"
                fontSize="10"
                fill={
                  status === 'upcoming'
                    ? 'var(--en-muted-foreground)'
                    : due
                      ? DUE_COLOR
                      : 'var(--en-primary)'
                }
                fontWeight={status === 'current' || due ? 600 : 400}
              >
                {MEMORY_CURVE_LABELS[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </section>
  )
}

/* ---- 闪卡 ---- */

function WordFlashcardFront({ word }: { word: WordEntry }) {
  return (
    <div className="flashcard" data-testid="flashcard-front">
      <div className="flashcard-front-body">
        <h2 className="flashcard-word">{word.word}</h2>
        <p className="flashcard-phonetic">{word.phonetic}</p>
        <p className="flashcard-pos">{word.partOfSpeech}</p>
        <div className="flashcard-hint">
          <Rotate3d size={14} />
          <span>点击卡片查看释义</span>
        </div>
      </div>
    </div>
  )
}

function WordFlashcardBack({ word }: { word: WordEntry }) {
  return (
    <div className="flashcard flashcard-back" data-testid="flashcard-back">
      <dl className="flashcard-back-body">
        <div>
          <dt>释义</dt>
          <dd>{word.definition}</dd>
        </div>
        <div>
          <dt>例句</dt>
          <dd className="flashcard-example">{word.example}</dd>
        </div>
        <div>
          <dt>翻译</dt>
          <dd className="flashcard-translation">{word.translation}</dd>
        </div>
        <div>
          <dt>近义词</dt>
          <dd>Syn: {word.synonyms.join(', ')}</dd>
        </div>
      </dl>
    </div>
  )
}

function PhraseFlashcardFront({ phrase }: { phrase: PhraseEntry }) {
  return (
    <div className="flashcard" data-testid="flashcard-front">
      <div className="flashcard-front-body">
        <h2 className="flashcard-word flashcard-phrase-text">{phrase.phrase}</h2>
        <div className="flashcard-hint">
          <Rotate3d size={14} />
          <span>点击卡片查看释义</span>
        </div>
      </div>
    </div>
  )
}

function PhraseFlashcardBack({ phrase }: { phrase: PhraseEntry }) {
  return (
    <div className="flashcard flashcard-back" data-testid="flashcard-back">
      <dl className="flashcard-back-body">
        <div>
          <dt>释义</dt>
          <dd>{phrase.definition}</dd>
        </div>
        <div>
          <dt>翻译</dt>
          <dd className="flashcard-translation">{phrase.translation}</dd>
        </div>
        <div>
          <dt>例句</dt>
          <dd className="flashcard-example">{phrase.example}</dd>
        </div>
      </dl>
    </div>
  )
}

/* ---- 页面 ---- */

/**
 * 词汇预习页：进度统计 + 艾宾浩斯记忆曲线 + 闪卡翻面 + 三档自评 + 右栏单词列表
 * 支持「单词 / 短语」双 Tab 切换，短语复用相同的间隔重复调度机制，进度独立存储。
 */
export function WordPreviewPage() {
  const { id } = useParams<{ id: string }>()

  /** 挂载时一次性加载文章与进度，避免重复读取 localStorage */
  const boot = useMemo(() => {
    const article = id ? getArticle(id) : undefined
    const words = article?.processing?.words ?? []
    const phrases = article?.processing?.phrases ?? []
    const savedWords = id ? loadWordProgress(id) : {}
    const savedPhrases = id ? loadPhraseProgress(id) : {}
    const firstUnratedWord = words.findIndex((w) => !savedWords[w.word])
    const firstUnratedPhrase = phrases.findIndex((p) => !savedPhrases[p.phrase])
    return {
      article,
      words,
      phrases,
      savedWords,
      savedPhrases,
      // 进入页面时定位到首个未评项（续学）；全部已评则停在末项
      initialWordIndex: firstUnratedWord === -1 ? Math.max(words.length - 1, 0) : firstUnratedWord,
      initialPhraseIndex: firstUnratedPhrase === -1 ? Math.max(phrases.length - 1, 0) : firstUnratedPhrase,
    }
  }, [id])

  const article = boot.article
  const words = boot.words
  const phrases = boot.phrases

  const [activeTab, setActiveTab] = useState<LearnTab>('words')
  const [wordRecords, setWordRecords] = useState<Record<string, WordProgressRecord>>(boot.savedWords)
  const [phraseRecords, setPhraseRecords] = useState<Record<string, WordProgressRecord>>(boot.savedPhrases)
  const [wordIndex, setWordIndex] = useState(boot.initialWordIndex)
  const [phraseIndex, setPhraseIndex] = useState(boot.initialPhraseIndex)
  const [flipped, setFlipped] = useState(false)
  /** 本轮自评全部完成 → 展示完成卡；从列表跳转可回到闪卡 */
  const [showCompletion, setShowCompletion] = useState(false)
  /** 生词本收录状态（单词/短语分集合），用于驱动收藏按钮 UI */
  const [collectedWords, setCollectedWords] = useState<Set<string>>(
    () => new Set(words.map((w) => w.word).filter((w) => isWordCollected(w))),
  )
  const [collectedPhrases, setCollectedPhrases] = useState<Set<string>>(
    () => new Set(phrases.map((p) => p.phrase).filter((p) => isPhraseCollected(p))),
  )

  useStudyTimeTracker()

  const items = activeTab === 'words' ? words : phrases
  const records = activeTab === 'words' ? wordRecords : phraseRecords
  const currentIndex = activeTab === 'words' ? wordIndex : phraseIndex
  const stats = computeStats(
    records,
    items.map((item) => (activeTab === 'words' ? (item as WordEntry).word : (item as PhraseEntry).phrase)),
  )
  const completedAll = items.length > 0 && stats.rated >= stats.total
  const currentItem = items[currentIndex]
  const currentKey = currentItem
    ? activeTab === 'words'
      ? (currentItem as WordEntry).word
      : (currentItem as PhraseEntry).phrase
    : ''

  /** 曲线节点状态 = 当前项的调度记录推导；全部学完则全程完成 */
  const curveStatuses: CurveNodeStatus[] = completedAll
    ? MEMORY_CURVE_LABELS.map(() => 'completed')
    : curveNodeStatuses(currentKey ? records[currentKey] : undefined)

  const handleRate = (rating: SelfRating) => {
    if (!id || !currentItem) return
    if (activeTab === 'words') {
      const word = currentItem as WordEntry
      const record = rateWord(id, word.word, rating)
      const nextRecords = { ...wordRecords, [word.word]: record }
      setWordRecords(nextRecords)
      setFlipped(false)
      setWordIndex((i) => Math.min(i + 1, words.length - 1))
      setShowCompletion(words.every((w) => nextRecords[w.word] !== undefined))
      autoCollectIfNeeded('words', word.word, rating, {
        phonetic: word.phonetic,
        translation: word.translation,
        partOfSpeech: word.partOfSpeech,
      })
    } else {
      const phrase = currentItem as PhraseEntry
      const record = ratePhrase(id, phrase.phrase, rating)
      const nextRecords = { ...phraseRecords, [phrase.phrase]: record }
      setPhraseRecords(nextRecords)
      setFlipped(false)
      setPhraseIndex((i) => Math.min(i + 1, phrases.length - 1))
      setShowCompletion(phrases.every((p) => nextRecords[p.phrase] !== undefined))
      autoCollectIfNeeded('phrases', phrase.phrase, rating, {
        phonetic: '',
        translation: phrase.translation,
      })
    }
  }

  /** 命中学习设置的自动收录档位时，把词收入生词本（已收录则跳过） */
  const autoCollectIfNeeded = (
    tab: LearnTab,
    text: string,
    rating: SelfRating,
    meta: { phonetic: string; translation: string; partOfSpeech?: string },
  ) => {
    const { autoCollectRatings } = loadSettings()
    if (!autoCollectRatings.includes(rating)) return
    if (tab === 'words') {
      if (!isWordCollected(text)) {
        addWordEntry({ text, articleId: id!, ...meta })
        setCollectedWords((prev) => new Set(prev).add(text))
      }
    } else {
      if (!isPhraseCollected(text)) {
        addPhraseEntry({ text, articleId: id!, ...meta })
        setCollectedPhrases((prev) => new Set(prev).add(text))
      }
    }
  }

  /** 手动切换生词本收录状态 */
  const handleToggleCollect = (tab: LearnTab, text: string) => {
    if (tab === 'words') {
      const word = words.find((w) => w.word === text)
      if (!word) return
      if (isWordCollected(text)) {
        removeWordEntry(text)
        setCollectedWords((prev) => {
          const next = new Set(prev)
          next.delete(text)
          return next
        })
      } else {
        addWordEntry({
          text,
          articleId: id!,
          phonetic: word.phonetic,
          translation: word.translation,
          partOfSpeech: word.partOfSpeech,
        })
        setCollectedWords((prev) => new Set(prev).add(text))
      }
    } else {
      const phrase = phrases.find((p) => p.phrase === text)
      if (!phrase) return
      if (isPhraseCollected(text)) {
        removePhraseEntry(text)
        setCollectedPhrases((prev) => {
          const next = new Set(prev)
          next.delete(text)
          return next
        })
      } else {
        addPhraseEntry({ text, articleId: id!, phonetic: '', translation: phrase.translation })
        setCollectedPhrases((prev) => new Set(prev).add(text))
      }
    }
  }

  const handleJump = (index: number) => {
    if (activeTab === 'words') setWordIndex(index)
    else setPhraseIndex(index)
    setFlipped(false)
    setShowCompletion(false)
  }

  const handleTabChange = (tab: LearnTab) => {
    setActiveTab(tab)
    setFlipped(false)
    setShowCompletion(false)
  }

  /** 无单词且无短语时显示泛化空态 */
  const hasNoContent = words.length === 0 && phrases.length === 0
  if (!article || hasNoContent) {
    const missing = article && words.length === 0
    return (
      <>
        <PageTopbar title="词汇预习" right={<span className="topbar-progress nums">0 / 0</span>} />
        <div className="app-content-inner">
          <div className="empty-state" data-testid="word-preview-empty">
            <BookOpen size={32} />
            <span className="empty-state-title">
              {missing ? '本文尚未提取单词或短语' : '暂无可预习的内容'}
            </span>
            <span className="empty-state-hint">
              {missing ? '先用 AI 预处理提取单词与短语，再回来预习' : '请先导入文章'}
            </span>
            {missing && (
              <Link
                to={routes.articleProcess(article.id)}
                className="function-btn function-btn-primary"
                data-dom-id="cta-ai-process"
              >
                <Sparkles size={16} />
                <span>去 AI 预处理</span>
              </Link>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTopbar
        title="词汇预习"
        right={
          <span className="topbar-progress nums" data-testid="topbar-progress">
            {stats.rated} / {stats.total}
          </span>
        }
      />
      <div className="app-content-inner">
        {/* 单词 / 短语 Tab 切换 */}
        <div className="learn-tabs" role="tablist" data-testid="learn-tabs">
          {(['words', 'phrases'] as LearnTab[]).map((tab) => {
            const count = tab === 'words' ? words.length : phrases.length
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`learn-tab ${isActive ? 'is-active' : ''}`}
                data-testid={`tab-${tab}`}
                onClick={() => handleTabChange(tab)}
              >
                <span>{TAB_LABELS[tab]}</span>
                <span className="learn-tab-count">{count}</span>
              </button>
            )
          })}
        </div>

        {items.length === 0 ? (
          <div className="empty-state empty-state-inline" data-testid={`empty-${activeTab}`}>
            <BookOpen size={28} />
            <span className="empty-state-title">
              {activeTab === 'words' ? '本文尚未提取单词' : '本文尚未提取短语'}
            </span>
            <span className="empty-state-hint">
              {activeTab === 'words' ? '去 AI 预处理提取单词' : '去 AI 预处理提取短语'}
            </span>
          </div>
        ) : (
          <div className="wp-columns">
            <div className="wp-left-col">
              <section>
                <div className="progress-bar">
                  <div
                    style={{ width: `${stats.total ? (stats.rated / stats.total) * 100 : 0}%` }}
                    data-testid="word-progress-fill"
                  />
                </div>
                <div className="progress-stats">
                  <span data-testid="stat-mastered">已掌握 {stats.mastered} 项</span>
                  <span className="stat-to-review" data-testid="stat-to-review">
                    待复习 {stats.toReview} 项
                  </span>
                </div>
              </section>

              <MemoryCurve statuses={curveStatuses} />

              {showCompletion ? (
                <div className="flashcard completion-card" data-testid="completion-card">
                  <div className="flashcard-front-body">
                    <h2 className="flashcard-word">全部完成！</h2>
                    <p className="flashcard-phonetic">
                      共 {stats.total} 项 · 已掌握 {stats.mastered} 项 · 待复习 {stats.toReview} 项
                    </p>
                    <p className="flashcard-hint">复习计划已按记忆曲线安排，可回列表继续其他模式</p>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`闪卡：${currentKey}，点击${flipped ? '查看正面' : '查看释义'}`}
                    onClick={() => setFlipped((f) => !f)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setFlipped((f) => !f)
                    }}
                    data-dom-id="cta-flip-card"
                    data-testid="flashcard"
                  >
                    {flipped ? (
                      activeTab === 'words' ? (
                        <WordFlashcardBack word={currentItem as WordEntry} />
                      ) : (
                        <PhraseFlashcardBack phrase={currentItem as PhraseEntry} />
                      )
                    ) : activeTab === 'words' ? (
                      <WordFlashcardFront word={currentItem as WordEntry} />
                    ) : (
                      <PhraseFlashcardFront phrase={currentItem as PhraseEntry} />
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      className={`flashcard-bookmark ${
                        (activeTab === 'words'
                          ? collectedWords.has(currentKey)
                          : collectedPhrases.has(currentKey))
                          ? 'is-collected'
                          : ''
                      }`}
                      aria-label={
                        activeTab === 'words'
                          ? collectedWords.has(currentKey)
                            ? '移出生词本'
                            : '加入生词本'
                          : collectedPhrases.has(currentKey)
                            ? '移出短语本'
                            : '加入短语本'
                      }
                      data-dom-id={`cta-flashcard-bookmark`}
                      data-testid="flashcard-bookmark"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleCollect(activeTab, currentKey)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          handleToggleCollect(activeTab, currentKey)
                        }
                      }}
                    >
                      {(activeTab === 'words'
                        ? collectedWords.has(currentKey)
                        : collectedPhrases.has(currentKey)) ? (
                        <BookmarkCheck size={18} />
                      ) : (
                        <Bookmark size={18} />
                      )}
                    </span>
                  </div>
                  <RatingControls onRate={handleRate} />
                </>
              )}
            </div>

            <div className="wp-right-col">
              <div className="word-list-sticky">
                <div className="word-list-header">
                  <h3>{activeTab === 'words' ? '全部单词' : '全部短语'}</h3>
                  <span className="nums">{stats.total}</span>
                </div>
                <div className="word-list" data-testid="word-list">
                  {items.map((item, index) => {
                    const key =
                      activeTab === 'words' ? (item as WordEntry).word : (item as PhraseEntry).phrase
                    const record = records[key]
                    const rowState = record ? 'completed' : index === currentIndex ? 'current' : 'upcoming'
                    const isCollected =
                      activeTab === 'words' ? collectedWords.has(key) : collectedPhrases.has(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`word-row is-${rowState}`}
                        data-word={key}
                        data-state={rowState}
                        data-testid={`word-row-${key}`}
                        onClick={() => handleJump(index)}
                      >
                        <span className="word-indicator">
                          {record && <Check size={12} />}
                        </span>
                        <span className="word-row-text">{key}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          className={`word-row-bookmark ${isCollected ? 'is-collected' : ''}`}
                          aria-label={isCollected ? '移出生词本' : '加入生词本'}
                          data-dom-id={`cta-bookmark-${key}`}
                          data-testid={`bookmark-${key}`}
                          data-collected={isCollected}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleCollect(activeTab, key)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              handleToggleCollect(activeTab, key)
                            }
                          }}
                        >
                          {isCollected ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
