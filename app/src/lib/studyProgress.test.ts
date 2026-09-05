import { describe, test, expect, beforeEach } from 'vitest'
import {
  addStudyMs,
  computeArticleProgress,
  dateKey,
  getTodayStudyMs,
  loadListeningProgress,
  loadPodcastProgress,
  markSentenceCompleted,
  savePodcastProgress,
  toModeProgress,
} from './studyProgress'
import type { Article } from './articles'

/**
 * 工单 #11 验收测试 — 学习进度闭环领域层
 * 覆盖：播客/精听进度持久化、今日学习时长按天累计与跨天归零、三模式进度汇聚
 */

const NOW = new Date('2026-09-03T12:00:00')

const word = (w: string) => ({
  word: w,
  phonetic: '/x/',
  partOfSpeech: 'n.',
  definition: 'd',
  translation: 't',
  example: 'e',
  synonyms: [],
})

const sentence = (text: string, i: number) => ({ text, startMs: i * 400, endMs: i * 400 + 400 })

const phrase = (p: string) => ({ phrase: p, definition: 'd', translation: 't', example: 'e' })

const ARTICLE: Article = {
  id: 'a1',
  title: 'T',
  source: 's',
  content: 'c',
  wordCount: 10,
  difficulty: 'Intermediate',
  createdAt: '2026-09-03',
  processing: {
    words: [word('procrastination'), word('rational'), word('deadline')],
    phrases: [phrase('instant gratification'), phrase('pull an all-nighter')],
    sentences: ['a', 'b', 'c', 'd', 'e'].map(sentence),
    audio: { audioUrl: 'x', mimeType: 'audio/wav', durationMs: 2000 },
  },
}

function seedArticle() {
  localStorage.setItem('linguaai.articles', JSON.stringify([ARTICLE]))
}

describe('播客收听进度', () => {
  beforeEach(() => localStorage.clear())

  test('未听过为 null；保存后可读取', () => {
    expect(loadPodcastProgress('a1')).toBeNull()
    savePodcastProgress('a1', 1200, 2000)
    expect(loadPodcastProgress('a1')).toEqual({ positionMs: 1200, durationMs: 2000 })
  })

  test('位置钳制在 [0, duration]；重复保存覆盖', () => {
    savePodcastProgress('a1', 9999, 2000)
    expect(loadPodcastProgress('a1')?.positionMs).toBe(2000)
    savePodcastProgress('a1', -5, 2000)
    expect(loadPodcastProgress('a1')?.positionMs).toBe(0)
    savePodcastProgress('a1', 800, 2000)
    expect(loadPodcastProgress('a1')?.positionMs).toBe(800)
  })
})

describe('精听进度', () => {
  beforeEach(() => localStorage.clear())

  test('默认空；标记句子幂等去重且升序', () => {
    expect(loadListeningProgress('a1')).toEqual({ completedSentences: [] })
    markSentenceCompleted('a1', 2)
    markSentenceCompleted('a1', 0)
    markSentenceCompleted('a1', 2)
    expect(loadListeningProgress('a1')).toEqual({ completedSentences: [0, 2] })
  })
})

describe('今日学习时长', () => {
  beforeEach(() => localStorage.clear())

  test('按天累计', () => {
    expect(getTodayStudyMs(NOW)).toBe(0)
    addStudyMs(60_000, NOW)
    addStudyMs(30_000, NOW)
    expect(getTodayStudyMs(NOW)).toBe(90_000)
  })

  test('跨天归零：存储日期非今日返回 0', () => {
    addStudyMs(90_000, NOW)
    const tomorrow = new Date('2026-09-04T08:00:00')
    expect(getTodayStudyMs(tomorrow)).toBe(0)
  })

  test('累计写入按当前日期归档（跨天后重新累计）', () => {
    addStudyMs(90_000, NOW)
    const tomorrow = new Date('2026-09-04T08:00:00')
    addStudyMs(30_000, tomorrow)
    expect(getTodayStudyMs(tomorrow)).toBe(30_000)
  })

  test('非正数忽略；脏存储返回 0', () => {
    addStudyMs(-100, NOW)
    addStudyMs(0, NOW)
    expect(getTodayStudyMs(NOW)).toBe(0)
    localStorage.setItem('linguaai.study_time', '{broken')
    expect(getTodayStudyMs(NOW)).toBe(0)
    localStorage.setItem('linguaai.study_time', JSON.stringify({ date: 'oops', ms: 'x' }))
    expect(getTodayStudyMs(NOW)).toBe(0)
  })

  test('dateKey 按本地时区生成 YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 8, 3, 0, 0))).toBe('2026-09-03')
    expect(dateKey(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01')
  })
})

describe('三模式进度汇聚', () => {
  beforeEach(() => {
    localStorage.clear()
    seedArticle()
  })

  test('无学习行为时全为 0', () => {
    const progress = computeArticleProgress(ARTICLE)
    expect(progress.words).toEqual({ done: 0, total: 3, percent: 0 })
    expect(progress.phrases).toEqual({ done: 0, total: 2, percent: 0 })
    expect(progress.podcast).toEqual({ done: 0, total: 0, percent: 0 })
    expect(progress.listening).toEqual({ done: 0, total: 5, percent: 0 })
  })

  test('汇聚三模式真实进度', () => {
    // 单词：评 2 词
    localStorage.setItem(
      'linguaai.word_progress',
      JSON.stringify({
        a1: {
          procrastination: { word: 'procrastination', rating: 'known', stage: 1, ratedAt: 'x', nextReviewAt: 'x' },
          rational: { word: 'rational', rating: 'fuzzy', stage: 0, ratedAt: 'x', nextReviewAt: 'x' },
        },
      }),
    )
    // 短语：评 1 个
    localStorage.setItem(
      'linguaai.phrase_progress',
      JSON.stringify({
        a1: {
          'instant gratification': { word: 'instant gratification', rating: 'known', stage: 1, ratedAt: 'x', nextReviewAt: 'x' },
        },
      }),
    )
    // 播客：听到 68%
    savePodcastProgress('a1', 1360, 2000)
    // 精听：提交 2 句
    markSentenceCompleted('a1', 1)
    markSentenceCompleted('a1', 3)

    const progress = computeArticleProgress(ARTICLE)
    expect(progress.words).toEqual({ done: 2, total: 3, percent: 67 })
    expect(progress.phrases).toEqual({ done: 1, total: 2, percent: 50 })
    expect(progress.podcast).toEqual({ done: 1360, total: 2000, percent: 68 })
    expect(progress.listening).toEqual({ done: 2, total: 5, percent: 40 })
  })

  test('陈旧精听记录（越界句子下标）不计入', () => {
    markSentenceCompleted('a1', 4)
    markSentenceCompleted('a1', 9)
    markSentenceCompleted('a1', -1)
    expect(computeArticleProgress(ARTICLE).listening.done).toBe(1)
  })

  test('播客进度以存储时长为准（文章重处理后旧进度不越界）', () => {
    savePodcastProgress('a1', 1900, 2000)
    expect(computeArticleProgress(ARTICLE).podcast.percent).toBe(95)
  })

  test('toModeProgress：total 为 0 时 percent 为 0', () => {
    expect(toModeProgress(0, 0)).toEqual({ done: 0, total: 0, percent: 0 })
    expect(toModeProgress(1, 3)).toEqual({ done: 1, total: 3, percent: 33 })
  })
})
