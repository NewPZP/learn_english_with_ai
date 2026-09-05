import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BookOpen, Check, Minus, Rotate3d, Sparkles, X } from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { getArticle } from '../lib/articles'
import { routes } from '../routes'
import type { WordEntry } from '../lib/ai'
import {
  computeStats,
  curveNodeStatuses,
  loadWordProgress,
  rateWord,
  MEMORY_CURVE_LABELS,
  MAX_STAGE,
  RATING_LABELS,
  type CurveNodeStatus,
  type SelfRating,
  type WordProgressRecord,
} from '../lib/wordProgress'
import { useStudyTimeTracker } from '../lib/useStudyTimeTracker'

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

function FlashcardFront({ word }: { word: WordEntry }) {
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

function FlashcardBack({ word }: { word: WordEntry }) {
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

/* ---- 三档自评按钮 ---- */

const RATING_META: Record<SelfRating, { icon: typeof X; className: string }> = {
  unknown: { icon: X, className: 'rate-unknown' },
  fuzzy: { icon: Minus, className: 'rate-fuzzy' },
  known: { icon: Check, className: 'rate-known' },
}

const RATING_ORDER: SelfRating[] = ['unknown', 'fuzzy', 'known']

function RatingControls({ onRate, disabled }: { onRate: (rating: SelfRating) => void; disabled?: boolean }) {
  return (
    <div className="repetition-controls">
      {RATING_ORDER.map((rating) => {
        const Icon = RATING_META[rating].icon
        return (
          <button
            key={rating}
            type="button"
            className={`repetition-btn ${RATING_META[rating].className}`}
            data-dom-id={`cta-rate-${rating}`}
            data-testid={`rate-${rating}`}
            onClick={() => onRate(rating)}
            disabled={disabled}
          >
            <Icon size={16} />
            <span>{RATING_LABELS[rating]}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ---- 页面 ---- */

/**
 * 单词预习页：进度统计 + 艾宾浩斯记忆曲线 + 闪卡翻面 + 三档自评 + 右栏单词列表
 * 自评驱动间隔重复调度（按档位计算下次复习时间并持久化）
 */
export function WordPreviewPage() {
  const { id } = useParams<{ id: string }>()

  /** 挂载时一次性加载文章与进度，避免重复读取 localStorage */
  const boot = useMemo(() => {
    const article = id ? getArticle(id) : undefined
    const words = article?.processing?.words ?? []
    const saved = id ? loadWordProgress(id) : {}
    const firstUnrated = words.findIndex((w) => !saved[w.word])
    return {
      article,
      words,
      saved,
      // 进入页面时定位到首个未评词（续学）；全部已评则停在末词
      initialIndex: firstUnrated === -1 ? Math.max(words.length - 1, 0) : firstUnrated,
    }
  }, [id])

  const article = boot.article
  const words = boot.words
  const [records, setRecords] = useState<Record<string, WordProgressRecord>>(boot.saved)
  const [currentIndex, setCurrentIndex] = useState(boot.initialIndex)
  const [flipped, setFlipped] = useState(false)
  /** 本轮自评全部完成 → 展示完成卡；从列表跳转可回到闪卡 */
  const [showCompletion, setShowCompletion] = useState(false)

  useStudyTimeTracker()

  const stats = computeStats(records, words.map((w) => w.word))
  const completedAll = words.length > 0 && stats.rated >= stats.total
  const currentWord = words[currentIndex]

  /** 曲线节点状态 = 当前词的调度记录推导（到期/已完成与真实复习计划对齐）；全部学完则全程完成 */
  const curveStatuses: CurveNodeStatus[] = completedAll
    ? MEMORY_CURVE_LABELS.map(() => 'completed')
    : curveNodeStatuses(currentWord ? records[currentWord.word] : undefined)

  const handleRate = (rating: SelfRating) => {
    if (!id || !currentWord) return
    const record = rateWord(id, currentWord.word, rating)
    const nextRecords = { ...records, [currentWord.word]: record }
    setRecords(nextRecords)
    setFlipped(false)
    setCurrentIndex((i) => Math.min(i + 1, words.length - 1))
    setShowCompletion(words.every((w) => nextRecords[w.word] !== undefined))
  }

  const handleJump = (index: number) => {
    setCurrentIndex(index)
    setFlipped(false)
    setShowCompletion(false)
  }

  if (!article || words.length === 0) {
    const missing = article && words.length === 0
    return (
      <>
        <PageTopbar title="单词预习" right={<span className="topbar-progress nums">0 / 0</span>} />
        <div className="app-content-inner">
          <div className="empty-state" data-testid="word-preview-empty">
            <BookOpen size={32} />
            <span className="empty-state-title">{missing ? '本文尚未提取单词' : '暂无可预习的单词'}</span>
            <span className="empty-state-hint">
              {missing ? '先用 AI 预处理提取单词，再回来预习' : '请先导入文章'}
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
        title="单词预习"
        right={
          <span className="topbar-progress nums" data-testid="topbar-progress">
            {stats.rated} / {stats.total}
          </span>
        }
      />
      <div className="app-content-inner">
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
                <span data-testid="stat-mastered">已掌握 {stats.mastered} 词</span>
                <span className="stat-to-review" data-testid="stat-to-review">
                  待复习 {stats.toReview} 词
                </span>
              </div>
            </section>

            <MemoryCurve statuses={curveStatuses} />

            {showCompletion ? (
              <div className="flashcard completion-card" data-testid="completion-card">
                <div className="flashcard-front-body">
                  <h2 className="flashcard-word">全部完成！</h2>
                  <p className="flashcard-phonetic">
                    共 {stats.total} 词 · 已掌握 {stats.mastered} 词 · 待复习 {stats.toReview} 词
                  </p>
                  <p className="flashcard-hint">复习计划已按记忆曲线安排，可回列表继续其他模式</p>
                </div>
              </div>
            ) : (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`闪卡：${currentWord.word}，点击${flipped ? '查看正面' : '查看释义'}`}
                  onClick={() => setFlipped((f) => !f)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setFlipped((f) => !f)
                  }}
                  data-dom-id="cta-flip-card"
                  data-testid="flashcard"
                >
                  {flipped ? <FlashcardBack word={currentWord} /> : <FlashcardFront word={currentWord} />}
                </div>
                <RatingControls onRate={handleRate} />
              </>
            )}
          </div>

          <div className="wp-right-col">
            <div className="word-list-sticky">
              <div className="word-list-header">
                <h3>全部单词</h3>
                <span className="nums">{stats.total}</span>
              </div>
              <div className="word-list" data-testid="word-list">
                {words.map((word, index) => {
                  const record = records[word.word]
                  const rowState = record ? 'completed' : index === currentIndex ? 'current' : 'upcoming'
                  return (
                    <button
                      key={word.word}
                      type="button"
                      className={`word-row is-${rowState}`}
                      data-word={word.word}
                      data-state={rowState}
                      data-testid={`word-row-${word.word}`}
                      onClick={() => handleJump(index)}
                    >
                      <span className="word-indicator">
                        {record && <Check size={12} />}
                      </span>
                      <span className="word-row-text">{word.word}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
