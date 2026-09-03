import { describe, test, expect } from 'vitest'
import {
  buildSentenceDictation,
  DICTATION_DIFFICULTY_LABELS,
  gradeBlank,
  gradeSubmission,
  normalizeForGrading,
  tokenize,
  vocabFromProcessing,
} from './dictation'
import type { PhraseEntry, WordEntry } from '../ai/types'

/**
 * 工单 #9 验收测试 — 听写挖空与判分纯函数
 * 覆盖：三档难度数据驱动挖空、分词、判分容错（大小写/空格）、整句汇总
 */

const VOCAB = {
  words: ['procrastination', 'anxiety'],
  phrases: ['pull an all-nighter'],
}

const SENTENCE = 'The result of procrastination is not laziness, but the anxiety that builds over time.'

describe('tokenize', () => {
  test('词元与分隔符分离（标点归分隔符）', () => {
    expect(tokenize('So finally, he decided to pull an all-nighter.')).toEqual([
      { kind: 'word', raw: 'So' },
      { kind: 'sep', raw: ' ' },
      { kind: 'word', raw: 'finally' },
      { kind: 'sep', raw: ', ' },
      { kind: 'word', raw: 'he' },
      { kind: 'sep', raw: ' ' },
      { kind: 'word', raw: 'decided' },
      { kind: 'sep', raw: ' ' },
      { kind: 'word', raw: 'to' },
      { kind: 'sep', raw: ' ' },
      { kind: 'word', raw: 'pull' },
      { kind: 'sep', raw: ' ' },
      { kind: 'word', raw: 'an' },
      { kind: 'sep', raw: ' ' },
      { kind: 'word', raw: 'all-nighter' },
      { kind: 'sep', raw: '.' },
    ])
  })

  test('空字符串与纯标点', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize(' — !')).toEqual([{ kind: 'sep', raw: ' — !' }])
  })
})

describe('buildSentenceDictation — 三档难度数据驱动挖空', () => {
  test('仅生词：只挖词汇表中的生词', () => {
    const dictation = buildSentenceDictation(SENTENCE, VOCAB, 'new')
    expect(dictation.blanks).toEqual(['procrastination', 'anxiety'])
    // 前后文本片段保留
    expect(dictation.segments[0]).toEqual({ kind: 'text', text: 'The result of ', blankIndex: -1 })
    expect(dictation.segments[1]).toEqual({ kind: 'blank', text: 'procrastination', blankIndex: 0 })
  })

  test('重要词语：生词 + 重点短语词元', () => {
    const dictation = buildSentenceDictation(
      'So finally, he decided to pull an all-nighter.',
      VOCAB,
      'key',
    )
    expect(dictation.blanks).toEqual(['pull', 'an', 'all-nighter'])
  })

  test('全部听写：所有词元挖空', () => {
    const dictation = buildSentenceDictation(SENTENCE, VOCAB, 'full')
    expect(dictation.blanks).toEqual([
      'The', 'result', 'of', 'procrastination', 'is', 'not', 'laziness', 'but', 'the',
      'anxiety', 'that', 'builds', 'over', 'time',
    ])
    // 尾部标点并入文本片段
    expect(dictation.segments.at(-1)).toEqual({ kind: 'text', text: '.', blankIndex: -1 })
  })

  test('无命中生词时 blanks 为空', () => {
    const dictation = buildSentenceDictation('A guy walked away.', VOCAB, 'new')
    expect(dictation.blanks).toEqual([])
    expect(dictation.segments).toEqual([{ kind: 'text', text: 'A guy walked away.', blankIndex: -1 }])
  })

  test('难度标签固定', () => {
    expect(DICTATION_DIFFICULTY_LABELS).toEqual({
      full: '全部听写',
      key: '重要词语',
      new: '仅生词',
    })
  })

  test('vocabFromProcessing 从处理产物提取词汇', () => {
    const words = [{ word: 'Thesis' } as WordEntry]
    const phrases = [{ phrase: 'pull an all-nighter' } as PhraseEntry]
    expect(vocabFromProcessing(words, phrases)).toEqual({
      words: ['Thesis'],
      phrases: ['pull an all-nighter'],
    })
    expect(vocabFromProcessing()).toEqual({ words: [], phrases: [] })
  })
})

describe('判分容错', () => {
  test('忽略大小写', () => {
    expect(gradeBlank('procrastination', 'Procrastination')).toBe(true)
    expect(gradeBlank('anxiety', 'ANXIETY')).toBe(true)
  })

  test('忽略空格（含中间空格）', () => {
    expect(gradeBlank('all-nighter', 'all -nighter')).toBe(true)
    expect(gradeBlank('anxiety', ' anxiety ')).toBe(true)
  })

  test('字母不一致判错，空输入判错', () => {
    expect(gradeBlank('anxiety', 'anxieyy')).toBe(false)
    expect(gradeBlank('anxiety', '')).toBe(false)
  })

  test('normalizeForGrading 只保留小写非空白字符', () => {
    expect(normalizeForGrading('  He LLO \t World ')).toBe('helloworld')
  })
})

describe('gradeSubmission — 整句判分', () => {
  test('逐空判分并汇总', () => {
    const result = gradeSubmission(['result', 'laziness', 'anxiety'], ['result', 'effort', ''])
    expect(result.totalCount).toBe(3)
    expect(result.correctCount).toBe(1)
    expect(result.allCorrect).toBe(false)
    expect(result.blanks[0]).toEqual({ answer: 'result', input: 'result', correct: true })
    expect(result.blanks[1]).toEqual({ answer: 'laziness', input: 'effort', correct: false })
    expect(result.blanks[2]).toEqual({ answer: 'anxiety', input: '', correct: false })
  })

  test('全对时 allCorrect 为 true', () => {
    const result = gradeSubmission(['Result', 'laziness'], ['result', 'LAZINESS '])
    expect(result.correctCount).toBe(2)
    expect(result.allCorrect).toBe(true)
  })

  test('输入不足的空按空串处理', () => {
    const result = gradeSubmission(['a', 'b'], ['a'])
    expect(result.blanks[1]).toEqual({ answer: 'b', input: '', correct: false })
  })
})
