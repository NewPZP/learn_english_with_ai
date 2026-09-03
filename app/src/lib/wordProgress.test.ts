import { describe, test, expect, beforeEach } from 'vitest'
import {
  computeStats,
  loadWordProgress,
  rateWord,
  nextStage,
  scheduleNext,
  type WordProgressRecord,
} from './wordProgress'

/**
 * 工单「单词预习模式」验收测试 — 调度与持久化
 */

const NOW = new Date('2026-09-03T10:00:00')

function daysLater(days: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

describe('档位推进规则', () => {
  test('认识：档位 +1，封顶 4', () => {
    expect(nextStage('known', 0)).toBe(1)
    expect(nextStage('known', 3)).toBe(4)
    expect(nextStage('known', 4)).toBe(4)
  })

  test('模糊：档位不变', () => {
    expect(nextStage('fuzzy', 0)).toBe(0)
    expect(nextStage('fuzzy', 3)).toBe(3)
  })

  test('不认识：归零', () => {
    expect(nextStage('unknown', 3)).toBe(0)
    expect(nextStage('unknown', 4)).toBe(0)
  })
})

describe('下次复习时间调度', () => {
  test('按新档位的间隔天数推算下次复习日期', () => {
    expect(scheduleNext('known', 0, NOW)).toEqual({ stage: 1, nextReviewAt: daysLater(2) })
    expect(scheduleNext('fuzzy', 1, NOW)).toEqual({ stage: 1, nextReviewAt: daysLater(2) })
    expect(scheduleNext('unknown', 4, NOW)).toEqual({ stage: 0, nextReviewAt: daysLater(1) })
  })

  test('档位 4 认识后停留在 15 天间隔', () => {
    expect(scheduleNext('known', 4, NOW)).toEqual({ stage: 4, nextReviewAt: daysLater(15) })
  })
})

describe('统计', () => {
  const records: Record<string, WordProgressRecord> = {
    a: { word: 'a', rating: 'known', stage: 1, ratedAt: '', nextReviewAt: '' },
    b: { word: 'b', rating: 'unknown', stage: 0, ratedAt: '', nextReviewAt: '' },
    c: { word: 'c', rating: 'fuzzy', stage: 0, ratedAt: '', nextReviewAt: '' },
  }

  test('已评/总数/已掌握/待复习', () => {
    expect(computeStats(records, ['a', 'b', 'c', 'd', 'e'])).toEqual({
      rated: 3,
      total: 5,
      mastered: 1,
      toReview: 2,
    })
  })

  test('不在当前词表内的陈旧记录不参与统计（文章重处理场景）', () => {
    expect(computeStats({ ...records, stale: records.a }, ['a', 'b', 'c'])).toEqual({
      rated: 3,
      total: 3,
      mastered: 1,
      toReview: 2,
    })
  })

  test('空记录', () => {
    expect(computeStats({}, ['a', 'b'])).toEqual({ rated: 0, total: 2, mastered: 0, toReview: 0 })
  })
})

describe('持久化（按文章 × 单词）', () => {
  beforeEach(() => localStorage.clear())

  test('rateWord 首评：从档位 0 起调度并持久化', () => {
    const record = rateWord('a1', 'procrastination', 'known', NOW)

    expect(record).toMatchObject({
      word: 'procrastination',
      rating: 'known',
      stage: 1,
      ratedAt: NOW.toISOString(),
      nextReviewAt: daysLater(2),
    })
    expect(loadWordProgress('a1').procrastination).toEqual(record)
  })

  test('再评基于上次档位推进（间隔重复记忆）', () => {
    rateWord('a1', 'w', 'known', NOW)
    const second = rateWord('a1', 'w', 'known', NOW)
    const third = rateWord('a1', 'w', 'known', NOW)
    expect(second.stage).toBe(2)
    expect(third.stage).toBe(3)
    expect(third.nextReviewAt).toBe(daysLater(7))
  })

  test('不认识归零后可重新爬升', () => {
    rateWord('a1', 'w', 'known', NOW)
    rateWord('a1', 'w', 'known', NOW)
    const reset = rateWord('a1', 'w', 'unknown', NOW)
    expect(reset.stage).toBe(0)
    expect(reset.nextReviewAt).toBe(daysLater(1))
    expect(rateWord('a1', 'w', 'fuzzy', NOW).stage).toBe(0)
  })

  test('多文章进度互不干扰', () => {
    rateWord('a1', 'w', 'known', NOW)
    rateWord('a2', 'w', 'unknown', NOW)
    expect(loadWordProgress('a1').w.stage).toBe(1)
    expect(loadWordProgress('a2').w.stage).toBe(0)
  })

  test('同文章多单词并存', () => {
    rateWord('a1', 'x', 'known', NOW)
    rateWord('a1', 'y', 'fuzzy', NOW)
    const records = loadWordProgress('a1')
    expect(Object.keys(records).sort()).toEqual(['x', 'y'])
  })

  test('损坏的存储数据返回空记录', () => {
    localStorage.setItem('linguaai.word_progress', '{invalid')
    expect(loadWordProgress('a1')).toEqual({})
  })
})
