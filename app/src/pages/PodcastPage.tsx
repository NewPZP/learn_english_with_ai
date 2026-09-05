import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  BookOpen,
  Clock,
  FileText,
  GraduationCap,
  Link2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Sparkles,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { getArticle } from '../lib/articles'
import { routes } from '../routes'
import {
  formatTime,
  useSentencePlayer,
  type AudioFactory,
} from '../lib/audio/useSentencePlayer'
import { markSentenceCompleted, savePodcastProgress, loadPodcastProgress } from '../lib/studyProgress'
import { useStudyTimeTracker } from '../lib/useStudyTimeTracker'
import { QuizChallengeTab, type GenerateQuiz } from './QuizChallengeTab'
import {
  buildSentenceDictation,
  DICTATION_DIFFICULTY_LABELS,
  gradeBlank,
  vocabFromProcessing,
  type DictationDifficulty,
  type SentenceDictation,
} from '../lib/listening/dictation'

const DIFFICULTY_ORDER: DictationDifficulty[] = ['full', 'key', 'new']
type PlaybackMode = 'continuous' | 'sentence'
type TabKey = 'dictation' | 'quiz'

/** 倍速显示文案：1 → 1.0x */
function speedLabel(rate: number): string {
  return `${rate.toFixed(1)}x`
}

/** 输入框状态：未判分 / 正确 / 错误 */
type BlankState = 'idle' | 'correct' | 'wrong'

/** 在 Record<number, T[]> 中按下标写入一个值（自动补齐长度） */
function setNested<T>(
  prev: Record<number, T[]>,
  sentenceIndex: number,
  blankIndex: number,
  value: T,
  fill: T,
): Record<number, T[]> {
  const arr = [...(prev[sentenceIndex] ?? [])]
  while (arr.length <= blankIndex) arr.push(fill)
  arr[blankIndex] = value
  return { ...prev, [sentenceIndex]: arr }
}

/**
 * 深入学习页：播客整篇播放 + 字幕挖空听写 + AI 综合测验（工单 #18、#19）
 * 以播客页为基础，移除右栏句子列表，顶部 Tab 切换「挖空听写 / AI 综合测验」。
 * 挖空听写支持三档屏蔽选项、全文显示开关；屏蔽词为整词输入框，
 * 失焦/回车/空格即判分（复用 gradeBlank，忽略大小写与空格），空格自动跳下一个空。
 * 播放控制区可切换「连续播放 / 单句播放」（单句播完自动停止）。
 * createAudio 可注入媒体元素（测试接缝，默认 new Audio()）。
 */
export function PodcastPage({
  createAudio,
  generateQuiz,
}: {
  createAudio?: AudioFactory
  generateQuiz?: GenerateQuiz
}) {
  const { id } = useParams<{ id: string }>()
  const article = useMemo(() => (id ? getArticle(id) : undefined), [id])
  const processing = article?.processing
  const sentences = processing?.sentences ?? []
  const audio = processing?.audio ?? null

  const player = useSentencePlayer({
    audioUrl: audio?.audioUrl ?? '',
    sentences,
    durationMs: audio?.durationMs ?? 0,
    createAudio,
  })

  useStudyTimeTracker()

  /**
   * 收听进度持久化：记录最远收听位置（回拖重听不回退进度）
   * 挂载时从存储恢复已有位置，避免重进页面时被 0 覆盖
   */
  const furthestMsRef = useRef(0)
  useEffect(() => {
    furthestMsRef.current = id ? loadPodcastProgress(id)?.positionMs ?? 0 : 0
  }, [id])
  useEffect(() => {
    if (!id) return
    furthestMsRef.current = Math.max(furthestMsRef.current, player.currentTimeMs)
    savePodcastProgress(id, furthestMsRef.current, audio?.durationMs ?? 0)
  }, [id, player.currentTimeMs, audio?.durationMs])

  const [activeTab, setActiveTab] = useState<TabKey>('dictation')
  /** 播放模式：continuous=连续播放整篇；sentence=单句播放，播完当前句自动停止 */
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('continuous')
  const [difficulty, setDifficulty] = useState<DictationDifficulty>('key')
  /** 全文显示开关：开启后句子以原文展示，关闭后为挖空输入 */
  const [showFullText, setShowFullText] = useState(false)

  // 同步播放模式到播放器
  useEffect(() => {
    player.setStopAfterSentence(playbackMode === 'sentence')
  }, [playbackMode, player])

  /** 每句的输入值：sentenceIndex → blankIndex → 输入字符串 */
  const [inputs, setInputs] = useState<Record<number, string[]>>({})
  /** 每句的判分结果：sentenceIndex → blankIndex → null(未判)/true/false */
  const [grades, setGrades] = useState<Record<number, (boolean | null)[]>>({})
  /** 已标记完成的句子下标集合（避免重复调用 markSentenceCompleted） */
  const completedSentencesRef = useRef<Set<number>>(new Set())

  const vocab = useMemo(
    () => vocabFromProcessing(processing?.words, processing?.phrases),
    [processing],
  )

  /** 每句的听写片段（难度变化时重新计算） */
  const dictations: SentenceDictation[] = useMemo(
    () => sentences.map((s) => buildSentenceDictation(s.text, vocab, difficulty)),
    [sentences, vocab, difficulty],
  )

  /** 难度变化：清空所有输入与判分（挖空下标随之变化，旧值失效） */
  useEffect(() => {
    setInputs({})
    setGrades({})
  }, [difficulty])

  // 当前句字幕自动滚动到可视区
  const currentLineRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    currentLineRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [player.currentIndex])

  /** 挖空输入框引用集合，用于空格跳转下一个空 */
  const blankInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function focusNextBlank(sentenceIndex: number, blankIndex: number) {
    const dictation = dictations[sentenceIndex]
    if (!dictation) return
    // 当前句内下一个空
    if (blankIndex + 1 < dictation.blanks.length) {
      blankInputRefs.current[`${sentenceIndex}-${blankIndex + 1}`]?.focus()
      return
    }
    // 跳到下一句第一个空
    for (let s = sentenceIndex + 1; s < dictations.length; s++) {
      if (dictations[s].blanks.length > 0) {
        blankInputRefs.current[`${s}-0`]?.focus()
        return
      }
    }
  }

  function updateInput(sentenceIndex: number, blankIndex: number, value: string) {
    setInputs((prev) => setNested(prev, sentenceIndex, blankIndex, value, ''))
    // 重新编辑时清除该空的判分结果
    setGrades((prev) => {
      if (prev[sentenceIndex]?.[blankIndex] === undefined) return prev
      return setNested(prev, sentenceIndex, blankIndex, null, null)
    })
  }

  function gradeInput(sentenceIndex: number, blankIndex: number) {
    const dictation = dictations[sentenceIndex]
    if (!dictation) return
    const answer = dictation.blanks[blankIndex]
    const value = inputs[sentenceIndex]?.[blankIndex] ?? ''
    const correct = gradeBlank(answer, value)
    setGrades((prev) => setNested(prev, sentenceIndex, blankIndex, correct, null))
    // 该句所有空均判为正确 → 标记句子完成
    const allGrades = dictation.blanks.map((_, i) =>
      i === blankIndex ? correct : grades[sentenceIndex]?.[i] ?? null,
    )
    if (
      dictation.blanks.length > 0 &&
      allGrades.every((g) => g === true) &&
      !completedSentencesRef.current.has(sentenceIndex)
    ) {
      completedSentencesRef.current.add(sentenceIndex)
      if (id) markSentenceCompleted(id, sentenceIndex)
    }
  }

  function handleInputKeyDown(
    sentenceIndex: number,
    blankIndex: number,
    e: KeyboardEvent<HTMLInputElement>,
  ) {
    if (e.key === 'Enter') {
      e.preventDefault()
      gradeInput(sentenceIndex, blankIndex)
      focusNextBlank(sentenceIndex, blankIndex)
    } else if (e.key === ' ') {
      // 空格：判定当前空并跳到下一个空
      e.preventDefault()
      gradeInput(sentenceIndex, blankIndex)
      focusNextBlank(sentenceIndex, blankIndex)
    }
  }

  function blankState(sentenceIndex: number, blankIndex: number): BlankState {
    const g = grades[sentenceIndex]?.[blankIndex]
    if (g === true) return 'correct'
    if (g === false) return 'wrong'
    return 'idle'
  }

  if (!article || !audio) {
    const missing = article && !audio
    return (
      <>
        <PageTopbar title="深入学习" />
        <div className="app-content-inner">
          <div className="empty-state" data-testid="podcast-empty">
            <GraduationCap size={32} />
            <span className="empty-state-title">{missing ? '本文尚未生成音频' : '暂无语音产物'}</span>
            <span className="empty-state-hint">
              {missing ? '先用 AI 预处理生成语音，再回来学习' : '请先导入文章'}
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
      <PageTopbar title="深入学习" />
      <div className="app-content-inner">
        <div className="deep-learning-stack">
          {/* 信息卡 */}
          <section className="info-card" data-testid="podcast-info-card">
            <h1 className="info-card-title">{article.title}</h1>
            <div className="info-card-meta">
              <span>{article.source}</span>
              <span className="dot" />
              <span className="info-card-duration">
                <Clock size={14} />
                {formatTime(audio.durationMs)}
              </span>
            </div>
            <div className="info-card-badges">
              <span className="stat-badge">
                <FileText size={14} />
                {article.wordCount.toLocaleString()} 词
              </span>
              <span className="stat-badge">
                <BookOpen size={14} />
                {processing?.words.length ?? 0} 生词
              </span>
              <span className="stat-badge">
                <Link2 size={14} />
                {processing?.phrases.length ?? 0} 短语
              </span>
            </div>
          </section>

          {/* Tab 切换：挖空听写 / 听力挑战 */}
          <div className="listening-tabs" data-testid="deep-learning-tabs">
            <button
              type="button"
              className={`listening-tab${activeTab === 'dictation' ? ' tab-active' : ' tab-inactive'}`}
              data-tab-key="dictation"
              aria-pressed={activeTab === 'dictation'}
              onClick={() => setActiveTab('dictation')}
            >
              挖空听写
            </button>
            <button
              type="button"
              className={`listening-tab${activeTab === 'quiz' ? ' tab-active' : ' tab-inactive'}`}
              data-tab-key="quiz"
              aria-pressed={activeTab === 'quiz'}
              onClick={() => setActiveTab('quiz')}
            >
              AI 综合测验
            </button>
          </div>

          {activeTab === 'quiz' ? (
            <QuizChallengeTab articleId={id} content={article.content} generateQuiz={generateQuiz} />
          ) : (
            <>
              {/* 难度 + 全文显示开关 */}
              <div className="dictation-toolbar">
                <div className="difficulty-pills" data-testid="difficulty-pills">
                  {DIFFICULTY_ORDER.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`diff-pill${difficulty === key ? ' diff-active' : ' diff-inactive'}`}
                      data-diff-key={key}
                      aria-pressed={difficulty === key}
                      onClick={() => setDifficulty(key)}
                    >
                      {DICTATION_DIFFICULTY_LABELS[key]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`fulltext-toggle${showFullText ? ' on' : ''}`}
                  data-testid="fulltext-toggle"
                  aria-pressed={showFullText}
                  onClick={() => setShowFullText((v) => !v)}
                >
                  {showFullText ? '隐藏全文' : '显示全文'}
                </button>
              </div>

              {/* 字幕挖空区 */}
              <section className="subtitle-area" data-testid="subtitle-area">
                {sentences.map((sentence, sIndex) => {
                  const dictation = dictations[sIndex]
                  const isCurrent = sIndex === player.currentIndex
                  return (
                    <p
                      key={sIndex}
                      ref={isCurrent ? currentLineRef : undefined}
                      className={`subtitle-line${isCurrent ? ' current' : ''}`}
                      data-sentence-index={sIndex}
                      data-testid={`subtitle-line-${sIndex}`}
                    >
                      {isCurrent && player.playing && (
                        <span className="playing-dot" aria-hidden="true" />
                      )}
                      {showFullText ? (
                        <span className="fulltext-line">{sentence.text}</span>
                      ) : (
                        dictation.segments.map((segment, segIndex) =>
                          segment.kind === 'text' ? (
                            <span key={segIndex}>{segment.text}</span>
                          ) : (
                            <span key={segIndex} className="word-blank-inline">
                              <input
                                ref={(el) => {
                                  blankInputRefs.current[`${sIndex}-${segment.blankIndex}`] = el
                                }}
                                type="text"
                                className={`blank-input blank-${blankState(sIndex, segment.blankIndex)}`}
                                value={inputs[sIndex]?.[segment.blankIndex] ?? ''}
                                style={{ width: `${Math.max(segment.text.length, 3)}ch` }}
                                aria-label={`第 ${sIndex + 1} 句第 ${segment.blankIndex + 1} 空`}
                                data-testid={`blank-${sIndex}-${segment.blankIndex}`}
                                onChange={(e) => updateInput(sIndex, segment.blankIndex, e.target.value)}
                                onBlur={() => gradeInput(sIndex, segment.blankIndex)}
                                onKeyDown={(e) => handleInputKeyDown(sIndex, segment.blankIndex, e)}
                              />
                            </span>
                          ),
                        )
                      )}
                    </p>
                  )
                })}
              </section>

              {/* 播放控制 */}
              <section className="player-controls">
                <input
                  type="range"
                  className="progress-slider"
                  min={0}
                  max={audio.durationMs}
                  step={100}
                  value={player.currentTimeMs}
                  style={{
                    ['--progress-percent' as string]: `${
                      audio.durationMs ? (player.currentTimeMs / audio.durationMs) * 100 : 0
                    }%`,
                  }}
                  aria-label="播放进度"
                  data-dom-id="podcast-progress"
                  data-testid="progress-slider"
                  onChange={(e) => player.seekToMs(Number(e.target.value))}
                />
                <div className="time-row">
                  <span data-testid="current-time">{formatTime(player.currentTimeMs)}</span>
                  <span data-testid="total-time">{formatTime(audio.durationMs)}</span>
                </div>
                {/* 播放模式：连续播放整篇 / 单句播放自动停止 */}
                <div className="playback-mode-toggle" data-testid="playback-mode-toggle">
                  <button
                    type="button"
                    className={`mode-pill${playbackMode === 'continuous' ? ' mode-active' : ' mode-inactive'}`}
                    data-mode="continuous"
                    aria-pressed={playbackMode === 'continuous'}
                    onClick={() => setPlaybackMode('continuous')}
                  >
                    连续播放
                  </button>
                  <button
                    type="button"
                    className={`mode-pill${playbackMode === 'sentence' ? ' mode-active' : ' mode-inactive'}`}
                    data-mode="sentence"
                    aria-pressed={playbackMode === 'sentence'}
                    onClick={() => setPlaybackMode('sentence')}
                  >
                    单句播放
                  </button>
                </div>
                <div className="controls-row">
                  <button
                    type="button"
                    className="control-btn"
                    aria-label="重复本句"
                    data-dom-id="cta-repeat-sentence"
                    onClick={player.repeatSentence}
                  >
                    <Repeat size={24} />
                  </button>
                  <button
                    type="button"
                    className="nav-btn"
                    aria-label="上一句"
                    data-dom-id="cta-prev-sentence"
                    onClick={player.prevSentence}
                  >
                    <SkipBack size={28} />
                  </button>
                  <button
                    type="button"
                    className="play-button"
                    aria-label={player.playing ? '暂停' : '播放'}
                    data-dom-id="cta-play-pause"
                    data-testid="play-pause"
                    onClick={player.togglePlay}
                  >
                    {player.playing ? <Pause size={28} /> : <Play size={28} />}
                  </button>
                  <button
                    type="button"
                    className="nav-btn"
                    aria-label="下一句"
                    data-dom-id="cta-next-sentence"
                    onClick={player.nextSentence}
                  >
                    <SkipForward size={28} />
                  </button>
                  <button
                    type="button"
                    className="speed-btn"
                    aria-label="播放速度"
                    data-dom-id="cta-playback-speed"
                    data-testid="speed-button"
                    onClick={player.cyclePlaybackRate}
                  >
                    {speedLabel(player.playbackRate)}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  )
}
