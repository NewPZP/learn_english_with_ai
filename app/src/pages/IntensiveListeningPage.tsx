import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Ear,
  Flame,
  Play,
  Target,
  Volume2,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { getArticle } from '../lib/articles'
import { useSentencePlayer, type AudioFactory } from '../lib/audio/useSentencePlayer'
import {
  buildSentenceDictation,
  DICTATION_DIFFICULTY_LABELS,
  gradeSubmission,
  vocabFromProcessing,
  type DictationDifficulty,
  type SentenceDictation,
  type SubmissionGrade,
} from '../lib/listening/dictation'

const DIFFICULTY_ORDER: DictationDifficulty[] = ['full', 'key', 'new']

/** 听力训练页统计（随提交作答更新） */
interface ListeningStats {
  gradedBlanks: number
  correctBlanks: number
  /** 连续全对的句数 */
  streak: number
}

/**
 * 听力训练页 · 逐句精听 Tab（工单 #9）
 * 挖空由文章生词/重点短语数据驱动（三档难度），逐字母输入自动前进/退格回退；
 * 提交后逐空判分（忽略大小写与空格），统计卡与顶栏进度随作答更新。
 * 音频复用 useSentencePlayer（工单 #8 的句子级播放组件）；听力挑战 Tab 为下一工单占位。
 */
export function IntensiveListeningPage({ createAudio }: { createAudio?: AudioFactory }) {
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

  const [activeTab, setActiveTab] = useState<'sentence' | 'quiz'>('sentence')
  const [difficulty, setDifficulty] = useState<DictationDifficulty>('key')
  const [sentenceIndex, setSentenceIndex] = useState(0)
  /** 判分结果与其所属 dictation 绑定：切句/切难度后旧结果立即失效，避免越界 */
  const [submission, setSubmission] = useState<{ dictation: SentenceDictation; grade: SubmissionGrade } | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [stats, setStats] = useState<ListeningStats>({ gradedBlanks: 0, correctBlanks: 0, streak: 0 })
  /** 训练起始时刻（首次提交时惰性初始化，避免渲染期调用不纯函数） */
  const startedAtRef = useRef(0)
  const [elapsedMs, setElapsedMs] = useState(0)

  const vocab = useMemo(() => vocabFromProcessing(processing?.words, processing?.phrases), [processing])

  const sentence = sentences[sentenceIndex]
  const dictation: SentenceDictation | null = useMemo(
    () => (sentence ? buildSentenceDictation(sentence.text, vocab, difficulty) : null),
    [sentence, vocab, difficulty],
  )
  const result = submission && submission.dictation === dictation ? submission.grade : null

  /** 逐空逐字母输入（letters[blankIndex][letterIndex]），挂载时按挖空数初始化 */
  const [letters, setLetters] = useState<string[][]>(() =>
    dictation ? dictation.blanks.map(() => []) : [],
  )

  // 切句/切难度时重置输入（渲染期状态调整模式：React 丢弃本次渲染输出后立即重渲）
  const [prevDictation, setPrevDictation] = useState<SentenceDictation | null>(dictation)
  if (prevDictation !== dictation) {
    setPrevDictation(dictation)
    setLetters(dictation ? dictation.blanks.map(() => []) : [])
  }

  const boxRefs = useRef<Array<Array<HTMLInputElement | null>>>([])
  const setBoxRef = (blankIndex: number, letterIndex: number, el: HTMLInputElement | null) => {
    boxRefs.current[blankIndex] ??= []
    boxRefs.current[blankIndex][letterIndex] = el
  }

  function playCurrentSentence() {
    player.goToSentence(sentenceIndex)
    player.play()
  }

  function handleLetterChange(blankIndex: number, letterIndex: number, answer: string, value: string) {
    const ch = value.slice(-1)
    setLetters((prev) => {
      const next = prev.map((arr) => [...arr])
      next[blankIndex] ??= []
      while (next[blankIndex].length < letterIndex) next[blankIndex].push('')
      next[blankIndex][letterIndex] = ch
      return next
    })
    // 输入自动前进到下一格
    if (ch && letterIndex < answer.length - 1) {
      boxRefs.current[blankIndex]?.[letterIndex + 1]?.focus()
    }
  }

  function handleLetterKeyDown(
    blankIndex: number,
    letterIndex: number,
    e: KeyboardEvent<HTMLInputElement>,
  ) {
    // 退格回退：当前格为空时聚焦上一格
    if (e.key === 'Backspace' && letterIndex > 0 && !letters[blankIndex]?.[letterIndex]) {
      e.preventDefault()
      boxRefs.current[blankIndex]?.[letterIndex - 1]?.focus()
    }
  }

  function handleSubmit() {
    if (!dictation || result || dictation.blanks.length === 0) return
    const inputs = dictation.blanks.map((_, i) => letters[i]?.join('') ?? '')
    const graded = gradeSubmission(dictation.blanks, inputs)
    setSubmission({ dictation, grade: graded })
    setStats((prev) => ({
      gradedBlanks: prev.gradedBlanks + graded.totalCount,
      correctBlanks: prev.correctBlanks + graded.correctCount,
      streak: graded.allCorrect ? prev.streak + 1 : 0,
    }))
    startedAtRef.current ||= Date.now()
    setElapsedMs(Date.now() - startedAtRef.current)
  }

  function goToSentence(index: number) {
    const clamped = Math.max(0, Math.min(index, sentences.length - 1))
    if (clamped === sentenceIndex) return
    player.pause()
    setSentenceIndex(clamped)
  }

  const accuracyPercent =
    stats.gradedBlanks > 0 ? Math.round((stats.correctBlanks / stats.gradedBlanks) * 100) : null
  const progressPercent = sentences.length ? ((sentenceIndex + 1) / sentences.length) * 100 : 0

  if (!article || !audio || sentences.length === 0) {
    return (
      <>
        <PageTopbar title="听力训练" />
        <div className="app-content-inner">
          <div className="empty-state" data-testid="listening-empty">
            <Ear size={32} />
            <span className="empty-state-title">暂无听力训练数据</span>
            <span className="empty-state-hint">请先导入文章并完成 AI 处理</span>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTopbar
        title="听力训练"
        right={
          <span className="page-topbar-progress nums" data-testid="topbar-progress">
            {sentenceIndex + 1} / {sentences.length}
          </span>
        }
      />
      <div className="app-content-inner">
        <div className="listening-stack">
          {/* 统计卡：进度条 + 正确率/用时/连续答对 */}
          <section className="section-card" data-testid="listening-stats">
            <div className="stats-progress-track">
              <div className="stats-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="stats-grid">
              <span className="stat-item" data-testid="stat-accuracy">
                <Target size={18} />
                正确率 {accuracyPercent === null ? '--' : `${accuracyPercent}%`}
              </span>
              <span className="stat-item" data-testid="stat-elapsed">
                <Clock size={18} />
                用时 {Math.floor(elapsedMs / 60000)}分
              </span>
              <span className="stat-item" data-testid="stat-streak">
                <Flame size={18} />
                连续 {stats.streak}句
              </span>
            </div>
          </section>

          {/* Tab 切换：逐句精听 / 听力挑战（下一工单） */}
          <div className="listening-tabs">
            <button
              type="button"
              className={`listening-tab${activeTab === 'sentence' ? ' tab-active' : ' tab-inactive'}`}
              data-tab-key="sentence"
              aria-pressed={activeTab === 'sentence'}
              onClick={() => setActiveTab('sentence')}
            >
              逐句精听
            </button>
            <button
              type="button"
              className={`listening-tab${activeTab === 'quiz' ? ' tab-active' : ' tab-inactive'}`}
              data-tab-key="quiz"
              aria-pressed={activeTab === 'quiz'}
              onClick={() => setActiveTab('quiz')}
            >
              听力挑战
            </button>
          </div>

          {activeTab === 'quiz' ? (
            <section className="section-card" data-testid="quiz-placeholder">
              <p className="placeholder-title">听力挑战</p>
              <p className="placeholder-hint">AI 智能出题训练，由下一工单实现</p>
            </section>
          ) : (
            <>
              {/* 听写难度三档 */}
              <div className="difficulty-row">
                <span className="difficulty-label">听写程度</span>
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
              </div>

              {/* 句子卡片：句序 + 播放 + 挖空听写 */}
              <section className="section-card" data-testid="sentence-card">
                <div className="sentence-card-head">
                  <span className="sentence-badge nums">第 {sentenceIndex + 1} 句</span>
                  <button
                    type="button"
                    className="audio-btn"
                    aria-label="播放音频"
                    data-testid="play-sentence"
                    onClick={playCurrentSentence}
                  >
                    <span className="audio-btn-icon">
                      <Volume2 size={20} />
                    </span>
                    <span>点击播放</span>
                  </button>
                </div>

                {dictation && dictation.blanks.length > 0 ? (
                  <p className="dictation-text" data-testid="dictation-text">
                    {dictation.segments.map((segment, i) =>
                      segment.kind === 'text' ? (
                        <span key={i}>{segment.text}</span>
                      ) : (
                        <span key={i} className="word-blank" data-answer={segment.text}>
                          <span className="word-letters">
                            {Array.from({ length: segment.text.length }, (_, li) => {
                              const grade = result?.blanks[segment.blankIndex]
                              return (
                                <input
                                  key={li}
                                  ref={(el) => setBoxRef(segment.blankIndex, li, el)}
                                  type="text"
                                  maxLength={1}
                                  className={`letter-box${
                                    grade ? (grade.correct ? ' correct' : ' wrong') : ''
                                  }`}
                                  value={letters[segment.blankIndex]?.[li] ?? ''}
                                  readOnly={!!result}
                                  aria-label={`第 ${segment.blankIndex + 1} 空第 ${li + 1} 字母`}
                                  data-testid={`letter-${segment.blankIndex}-${li}`}
                                  onChange={(e) =>
                                    handleLetterChange(
                                      segment.blankIndex,
                                      li,
                                      segment.text,
                                      e.target.value,
                                    )
                                  }
                                  onKeyDown={(e) => handleLetterKeyDown(segment.blankIndex, li, e)}
                                />
                              )
                            })}
                          </span>
                          <span
                            className={`word-status${
                              result
                                ? result.blanks[segment.blankIndex].correct
                                  ? ' show correct'
                                  : ' show wrong'
                                : ''
                            }`}
                            aria-hidden="true"
                          >
                            {result
                              ? result.blanks[segment.blankIndex].correct
                                ? '✓'
                                : '✗'
                              : ''}
                          </span>
                        </span>
                      ),
                    )}
                  </p>
                ) : (
                  <p className="dictation-empty" data-testid="dictation-empty">
                    本句没有需要听写的词语，可切换听写程度或直接听下一句。
                  </p>
                )}

                {sentence.translation && (
                  <>
                    <button
                      type="button"
                      className="translation-toggle"
                      data-testid="translation-toggle"
                      aria-expanded={showTranslation}
                      onClick={() => setShowTranslation((v) => !v)}
                    >
                      <ChevronRight
                        size={16}
                        className={`chevron${showTranslation ? ' chevron-open' : ''}`}
                      />
                      <span>显示译文</span>
                    </button>
                    {showTranslation && (
                      <p className="translation-text" data-testid="translation-text">
                        {sentence.translation}
                      </p>
                    )}
                  </>
                )}
              </section>

              {/* 操作：播放原文 + 提交答案 */}
              <div className="listening-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={playCurrentSentence}
                  data-testid="play-original"
                >
                  <Play size={16} />
                  <span>播放原文</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={!dictation || dictation.blanks.length === 0 || !!result}
                  data-testid="submit-answer"
                >
                  <Check size={16} />
                  <span>提交答案</span>
                </button>
              </div>

              {/* 判分反馈：逐空结果 + 完整正确句 */}
              {result && dictation && (
                <section className="section-card" data-testid="result-feedback">
                  <div className="feedback-head">
                    <CheckCircle2
                      size={20}
                      className={result.allCorrect ? 'feedback-icon-ok' : 'feedback-icon-partial'}
                    />
                    <span
                      className={`feedback-title${result.allCorrect ? ' ok' : ' partial'}`}
                      data-testid="feedback-title"
                    >
                      {result.allCorrect ? '完美！' : '再接再厉！'}
                    </span>
                    <span className="feedback-summary nums" data-testid="feedback-summary">
                      {result.correctCount} / {result.totalCount} 空格正确
                    </span>
                  </div>
                  <div className="feedback-blanks">
                    {result.blanks.map((blank, i) => (
                      <div
                        key={i}
                        className="feedback-blank-row"
                        data-testid={`feedback-blank-${i}`}
                        data-correct={blank.correct}
                      >
                        <span className="feedback-index nums">{i + 1}.</span>
                        {blank.correct ? (
                          <span className="feedback-answer ok">{blank.answer}</span>
                        ) : (
                          <>
                            <span className="feedback-input-wrong">{blank.input || '（未填）'}</span>
                            <span className="feedback-arrow">→</span>
                            <span className="feedback-answer ok">{blank.answer}</span>
                          </>
                        )}
                        <Check size={16} className={blank.correct ? 'feedback-icon-ok' : 'hidden'} />
                      </div>
                    ))}
                  </div>
                  <div className="correct-sentence" data-testid="correct-sentence">
                    {sentence.text}
                  </div>
                </section>
              )}

              {/* 上一句 / 下一句 */}
              <div className="listening-nav">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => goToSentence(sentenceIndex - 1)}
                  disabled={sentenceIndex === 0}
                  aria-label="上一句"
                  data-testid="prev-sentence"
                >
                  <ChevronLeft size={16} />
                  <span>上一句</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => goToSentence(sentenceIndex + 1)}
                  disabled={sentenceIndex === sentences.length - 1}
                  aria-label="下一句"
                  data-testid="next-sentence"
                >
                  <span>下一句</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
