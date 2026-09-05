import { useEffect, useMemo, useState } from 'react'
import { Award, Check, CheckCircle2, Loader2, RefreshCw, Sparkles, X, XCircle } from 'lucide-react'
import { getTextAdapter } from '../lib/ai'
import type { Quiz } from '../lib/ai/types'
import {
  clearQuizCache,
  loadQuizCache,
  saveQuizCache,
} from '../lib/studyProgress'
import {
  answerText,
  booleanText,
  countUnanswered,
  gradeQuizSet,
  isAnswered,
  type QuizAnswer,
  type QuizSetGrade,
} from '../lib/listening/quiz'

export type GenerateQuiz = (content: string) => Promise<Quiz[]>

/** 正确答案展示文本（判分反馈用） */
function correctAnswerText(quiz: Quiz): string {
  return quiz.type === 'true-false' ? booleanText(quiz.answer) : quiz.answer
}

/**
 * AI 综合测验 Tab（工单 #10、#19）：AI 智能出题 + 三题型 + 整卷判分
 * 题目由文字模型适配器生成（当前 mock，两套题库轮换）；
 * 生成的题目按 articleId 持久化到 localStorage，复用以减少 token 消耗；
 * 「刷新题库」清除缓存并重新生成。
 * 渲染与判分按 quiz.type 数据驱动，新增题型只需扩展渲染分支与判分规则
 */
export function QuizChallengeTab({
  articleId,
  content,
  generateQuiz,
}: {
  articleId?: string
  content: string
  generateQuiz?: GenerateQuiz
}) {
  // 适配器实例固定：mock 轮换游标随实例推进，「刷新题库」才能换题组
  const adapter = useMemo(() => getTextAdapter(), [])
  // 出题函数引用稳定：否则每次渲染都触发 effect 重新出题（游标被推进两次）
  const generate = useMemo<GenerateQuiz>(
    () => generateQuiz ?? ((text: string) => adapter.generateQuiz(text)),
    [generateQuiz, adapter],
  )

  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null)
  const [answers, setAnswers] = useState<(QuizAnswer | undefined)[]>([])
  const [result, setResult] = useState<QuizSetGrade | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 刷新计数：递增触发重新出题并重置作答 */
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    // 优先读取缓存，命中则直接复用，避免重复消耗 token
    const cached = articleId ? loadQuizCache(articleId) : null
    if (cached) {
      setQuizzes(cached)
      setAnswers(new Array<QuizAnswer | undefined>(cached.length))
      setLoading(false)
      return
    }
    generate(content)
      .then((next) => {
        if (cancelled) return
        setQuizzes(next)
        setAnswers(new Array<QuizAnswer | undefined>(next.length))
        if (articleId) saveQuizCache(articleId, next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '出题失败，请重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [generate, content, loadKey, articleId])

  const unanswered = quizzes ? countUnanswered(quizzes, answers) : 0
  const submitted = !!result

  function setAnswer(index: number, answer: QuizAnswer) {
    if (submitted) return
    setAnswers((prev) => {
      const next = [...prev]
      next[index] = answer
      return next
    })
  }

  function handleSubmit() {
    if (!quizzes || submitted || unanswered > 0) return
    setResult(gradeQuizSet(quizzes, answers))
  }

  function handleRefresh() {
    setResult(null)
    setError(null)
    setLoading(true)
    // 刷新题库：清除缓存，强制重新生成
    if (articleId) clearQuizCache(articleId)
    setLoadKey((key) => key + 1)
  }

  if (loading) {
    return (
      <div className="quiz-loading" data-testid="quiz-loading">
        <Loader2 size={20} className="spin" />
        <span>AI 正在出题...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="quiz-error" data-testid="quiz-error">
        <XCircle size={20} />
        <span>{error}</span>
        <button type="button" className="btn btn-secondary" onClick={handleRefresh}>
          重试
        </button>
      </div>
    )
  }

  if (!quizzes || quizzes.length === 0) {
    return (
      <div className="quiz-empty" data-testid="quiz-empty">
        <span>本次没有生成题目，可刷新题库重试</span>
      </div>
    )
  }

  return (
    <>
      {/* 头部：AI 出题徽章 + 题目数 + 刷新题库 */}
      <div className="quiz-header" data-testid="quiz-header">
        <div className="quiz-header-left">
          <span className="quiz-badge" data-testid="quiz-badge">
            <Sparkles size={14} />
            AI 智能出题
          </span>
          <span className="quiz-count" data-testid="quiz-count">
            共 {quizzes.length} 题
          </span>
        </div>
        <button
          type="button"
          className="refresh-btn"
          data-testid="refresh-quiz"
          onClick={handleRefresh}
        >
          <RefreshCw size={16} className={loading ? 'spin' : undefined} />
          <span>刷新题库</span>
        </button>
      </div>

      {/* 题目卡片：渲染按 quiz.type 数据驱动 */}
      {quizzes.map((quiz, i) => {
        const grade = result?.results[i]
        return (
          <section className="quiz-card" key={i} data-testid={`quiz-card-${i}`}>
            <div className="quiz-question">
              <span className="quiz-question-index nums">Q{i + 1}</span>
              <p className="quiz-question-text">{quiz.question}</p>
            </div>

            {quiz.type === 'single-choice' && (
              <div className="quiz-options">
                {quiz.options.map((option, j) => {
                  const selected = answers[i] === option
                  const state = submitted
                    ? option === quiz.answer
                      ? ' correct'
                      : selected
                        ? ' wrong'
                        : ''
                    : selected
                      ? ' selected'
                      : ''
                  return (
                    <button
                      key={j}
                      type="button"
                      className={`quiz-option${state}`}
                      data-testid={`quiz-option-${i}-${j}`}
                      aria-pressed={selected}
                      disabled={submitted}
                      onClick={() => setAnswer(i, option)}
                    >
                      <span className="quiz-option-label">{String.fromCharCode(65 + j)}</span>
                      <span className="quiz-option-text">{option}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {quiz.type === 'fill-blank' && (
              <input
                type="text"
                className={`quiz-fill-input${
                  submitted ? (grade?.correct ? ' correct' : ' wrong') : ''
                }`}
                data-testid={`quiz-fill-${i}`}
                aria-label={`第 ${i + 1} 题填空答案`}
                placeholder="输入你的答案..."
                value={typeof answers[i] === 'string' ? (answers[i] as string) : ''}
                readOnly={submitted}
                onChange={(e) => setAnswer(i, e.target.value)}
              />
            )}

            {quiz.type === 'true-false' && (
              <div className="quiz-true-false">
                {([true, false] as const).map((value) => {
                  const selected = answers[i] === value
                  const state = submitted
                    ? value === quiz.answer
                      ? ' correct'
                      : selected
                        ? ' wrong'
                        : ''
                    : selected
                      ? ' selected'
                      : ''
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      className={`quiz-option quiz-option-tf${state}`}
                      data-testid={`quiz-tf-${i}-${value}`}
                      aria-pressed={selected}
                      disabled={submitted}
                      onClick={() => setAnswer(i, value)}
                    >
                      {value ? (
                        <Check size={16} className="icon-success" />
                      ) : (
                        <X size={16} className="icon-error" />
                      )}
                      <span>{booleanText(value)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      {/* 提交：未答完阻止并提示 */}
      <button
        type="button"
        className="btn btn-primary quiz-submit"
        data-testid="submit-quiz"
        onClick={handleSubmit}
        disabled={submitted || unanswered > 0}
      >
        <CheckCircle2 size={16} />
        <span>提交全部答案</span>
      </button>
      {!submitted && unanswered > 0 && (
        <p className="quiz-unanswered-hint" data-testid="unanswered-hint">
          还有 {unanswered} 题未作答，答完才能提交
        </p>
      )}

      {/* 整卷判分反馈：总分 + 逐题结果 */}
      {result && (
        <section className="quiz-feedback" data-testid="quiz-feedback">
          <div className="quiz-feedback-head">
            <span className={`quiz-feedback-icon${result.allCorrect ? ' ok' : ' partial'}`}>
              <Award size={22} />
            </span>
            <div>
              <div className="quiz-feedback-score nums" data-testid="quiz-score">
                {result.correctCount} / {result.totalCount} 正确
              </div>
              <div className="quiz-feedback-comment" data-testid="quiz-comment">
                {result.allCorrect ? '完美！' : '再接再厉！'}
              </div>
            </div>
          </div>
          <div className="quiz-feedback-rows">
            {result.results.map((grade, i) => (
              <div
                key={i}
                className="quiz-feedback-row"
                data-testid={`quiz-feedback-${i}`}
                data-correct={grade.correct}
              >
                {grade.correct ? (
                  <CheckCircle2 size={16} className="icon-success" />
                ) : (
                  <XCircle size={16} className="icon-error" />
                )}
                <span className="quiz-feedback-index nums">Q{i + 1}</span>
                {grade.correct ? (
                  <span className="quiz-feedback-correct">回答正确</span>
                ) : (
                  <span className="quiz-feedback-wrong-wrap">
                    <span className="quiz-feedback-input">{answerText(grade.answer) || '（未作答）'}</span>
                    <span className="quiz-feedback-arrow">→</span>
                    <span className="quiz-feedback-answer">{correctAnswerText(grade.quiz)}</span>
                  </span>
                )}
                <p className="quiz-explanation">
                  {isAnswered(grade.quiz, grade.answer) ? '' : '未作答。'}
                  {grade.quiz.explanation}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
