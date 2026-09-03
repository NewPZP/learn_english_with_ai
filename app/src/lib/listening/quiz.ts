/**
 * 听力挑战 — 纯函数域（工单 #10）
 * 三题型判分：单选（选项精确匹配）/ 填空（忽略大小写与空格，复用听写容错规则）/ 判断（布尔等值）
 * 页面与测试只依赖这里的纯函数；新增题型只需扩展判分分支与作答渲染
 */
import type { Quiz } from '../ai/types'
import { normalizeForGrading } from './dictation'

/** 作答值：单选存选项文本、填空存文本、判断存布尔 */
export type QuizAnswer = string | boolean

/** 是否已作答（空串/undefined 视为未答） */
export function isAnswered(quiz: Quiz, answer: QuizAnswer | undefined): boolean {
  if (quiz.type === 'true-false') return typeof answer === 'boolean'
  return typeof answer === 'string' && answer.trim().length > 0
}

/** 单题判分 */
export function gradeQuiz(quiz: Quiz, answer: QuizAnswer | undefined): boolean {
  switch (quiz.type) {
    case 'single-choice':
      return answer === quiz.answer
    case 'fill-blank':
      return typeof answer === 'string' && normalizeForGrading(answer) === normalizeForGrading(quiz.answer)
    case 'true-false':
      return answer === quiz.answer
  }
}

/** 作答的展示文本（判分反馈中划线展示；未答显示空串） */
export function answerText(answer: QuizAnswer | undefined): string {
  if (typeof answer === 'boolean') return answer ? '正确' : '错误'
  return answer ?? ''
}

/** 判断题答案的展示文本 */
export function booleanText(value: boolean): string {
  return value ? '正确' : '错误'
}

export interface QuizGrade {
  quiz: Quiz
  answer: QuizAnswer | undefined
  answered: boolean
  correct: boolean
}

export interface QuizSetGrade {
  results: QuizGrade[]
  correctCount: number
  totalCount: number
  allCorrect: boolean
}

/** 整卷判分：逐题独立判分并汇总 */
export function gradeQuizSet(quizzes: Quiz[], answers: (QuizAnswer | undefined)[]): QuizSetGrade {
  const results = quizzes.map((quiz, i) => {
    const answer = answers[i]
    return {
      quiz,
      answer,
      answered: isAnswered(quiz, answer),
      correct: gradeQuiz(quiz, answer),
    }
  })
  const correctCount = results.filter((r) => r.correct).length
  return {
    results,
    correctCount,
    totalCount: quizzes.length,
    allCorrect: quizzes.length > 0 && correctCount === quizzes.length,
  }
}

/** 未作答的题目数（提交前提示用） */
export function countUnanswered(quizzes: Quiz[], answers: (QuizAnswer | undefined)[]): number {
  return quizzes.filter((quiz, i) => !isAnswered(quiz, answers[i])).length
}
