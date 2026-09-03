import { describe, test, expect } from 'vitest'
import {
  answerText,
  booleanText,
  countUnanswered,
  gradeQuiz,
  gradeQuizSet,
  isAnswered,
} from './quiz'
import type { Quiz } from '../ai/types'

/**
 * 工单 #10 验收测试 — 听力挑战判分纯函数
 * 覆盖：三题型判分规则（单选精确匹配/填空容错/判断布尔）、未答统计、整卷汇总
 */

const SINGLE: Quiz = {
  type: 'single-choice',
  question: '文章作者认为拖延的核心原因是什么？',
  options: ['A 选项', 'B 选项', 'C 选项', 'D 选项'],
  answer: 'B 选项',
  explanation: '解释',
}

const FILL: Quiz = {
  type: 'fill-blank',
  question: '根据文章内容填空：The monkey cares only about ______.',
  answer: 'easy and fun',
  explanation: '解释',
}

const TF: Quiz = {
  type: 'true-false',
  question: '判断正误：Panic Monster 只在截止日期临近时才会出现。',
  answer: false,
  explanation: '解释',
}

const QUIZZES = [SINGLE, FILL, TF]

describe('isAnswered', () => {
  test('单选/填空：非空字符串视为已答', () => {
    expect(isAnswered(SINGLE, 'B 选项')).toBe(true)
    expect(isAnswered(SINGLE, '')).toBe(false)
    expect(isAnswered(SINGLE, '  ')).toBe(false)
    expect(isAnswered(SINGLE, undefined)).toBe(false)
    expect(isAnswered(FILL, 'easy')).toBe(true)
  })

  test('判断：布尔值视为已答，字符串不算', () => {
    expect(isAnswered(TF, true)).toBe(true)
    expect(isAnswered(TF, false)).toBe(true)
    expect(isAnswered(TF, undefined)).toBe(false)
    expect(isAnswered(TF, '正确')).toBe(false)
  })
})

describe('gradeQuiz — 三题型判分规则', () => {
  test('单选：选项精确匹配（不忽略空格大小写以外的差异）', () => {
    expect(gradeQuiz(SINGLE, 'B 选项')).toBe(true)
    expect(gradeQuiz(SINGLE, 'A 选项')).toBe(false)
    expect(gradeQuiz(SINGLE, undefined)).toBe(false)
  })

  test('填空：忽略大小写与空格', () => {
    expect(gradeQuiz(FILL, 'easy and fun')).toBe(true)
    expect(gradeQuiz(FILL, 'Easy And Fun')).toBe(true)
    expect(gradeQuiz(FILL, ' easy  and fun ')).toBe(true)
    expect(gradeQuiz(FILL, 'easyandfun')).toBe(true)
    expect(gradeQuiz(FILL, 'hard work')).toBe(false)
    expect(gradeQuiz(FILL, '')).toBe(false)
    expect(gradeQuiz(FILL, undefined)).toBe(false)
  })

  test('判断：布尔等值', () => {
    expect(gradeQuiz(TF, false)).toBe(true)
    expect(gradeQuiz(TF, true)).toBe(false)
    expect(gradeQuiz(TF, undefined)).toBe(false)
  })
})

describe('gradeQuizSet — 整卷判分', () => {
  test('逐题判分并汇总', () => {
    const grade = gradeQuizSet(QUIZZES, ['B 选项', 'hard work', true])
    expect(grade.totalCount).toBe(3)
    expect(grade.correctCount).toBe(1)
    expect(grade.allCorrect).toBe(false)
    expect(grade.results[0]).toMatchObject({ answered: true, correct: true })
    expect(grade.results[1]).toMatchObject({ answered: true, correct: false })
    expect(grade.results[2]).toMatchObject({ answered: true, correct: false })
  })

  test('全对时 allCorrect 为 true', () => {
    const grade = gradeQuizSet(QUIZZES, ['B 选项', 'EASY AND FUN', false])
    expect(grade.correctCount).toBe(3)
    expect(grade.allCorrect).toBe(true)
  })

  test('未答题目判错且标记未答', () => {
    const grade = gradeQuizSet(QUIZZES, [undefined, 'easy and fun', undefined])
    expect(grade.results[0]).toMatchObject({ answered: false, correct: false })
    expect(grade.results[1]).toMatchObject({ answered: true, correct: true })
    expect(grade.results[2]).toMatchObject({ answered: false, correct: false })
    expect(grade.correctCount).toBe(1)
  })
})

describe('countUnanswered 与展示文本', () => {
  test('统计未答数', () => {
    expect(countUnanswered(QUIZZES, ['B 选项', '', false])).toBe(1)
    expect(countUnanswered(QUIZZES, [])).toBe(3)
    expect(countUnanswered(QUIZZES, ['x', 'y', true])).toBe(0)
  })

  test('answerText / booleanText 展示', () => {
    expect(answerText('B 选项')).toBe('B 选项')
    expect(answerText(true)).toBe('正确')
    expect(answerText(false)).toBe('错误')
    expect(answerText(undefined)).toBe('')
    expect(answerText('')).toBe('')
    expect(booleanText(true)).toBe('正确')
    expect(booleanText(false)).toBe('错误')
  })
})
