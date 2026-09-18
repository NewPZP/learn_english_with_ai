import { describe, test, expect, beforeEach } from 'vitest'
import {
  addWordEntry,
  removeWordEntry,
  listWordEntries,
  isWordCollected,
  addPhraseEntry,
  removePhraseEntry,
  listPhraseEntries,
  isPhraseCollected,
  aggregateLatestWordRecord,
  aggregateLatestPhraseRecord,
  getWordSourceRecords,
  familiarityOf,
  setWordFamiliarity,
  setPhraseFamiliarity,
} from './vocabBook'
import { rateWord, ratePhrase } from './wordProgress'

const NOW = new Date('2026-09-03T10:00:00')

describe('单词收录', () => {
  beforeEach(() => localStorage.clear())

  test('addWordEntry 新建并持久化', () => {
    addWordEntry({
      text: 'procrastination',
      phonetic: '/prəˌkræstɪˈneɪʃən/',
      translation: '拖延症',
      partOfSpeech: 'n.',
      articleId: 'a1',
      now: NOW,
    })
    expect(isWordCollected('procrastination')).toBe(true)
    const list = listWordEntries()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      text: 'procrastination',
      phonetic: '/prəˌkræstɪˈneɪʃən/',
      translation: '拖延症',
      partOfSpeech: 'n.',
      sourceArticleIds: ['a1'],
      collectedAt: NOW.toISOString(),
    })
  })

  test('同一词来自多篇文章时合并 sourceArticleIds，保留首次收录时间', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    const later = new Date('2026-09-05T10:00:00')
    addWordEntry({ text: 'w', articleId: 'a2', now: later })

    const list = listWordEntries()
    expect(list).toHaveLength(1)
    expect(list[0].sourceArticleIds).toEqual(['a1', 'a2'])
    expect(list[0].collectedAt).toBe(NOW.toISOString())
  })

  test('重复收录同一文章不重复添加 sourceArticleId', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    expect(listWordEntries()[0].sourceArticleIds).toEqual(['a1'])
  })

  test('removeWordEntry 移除后 isCollected 为 false', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    removeWordEntry('w')
    expect(isWordCollected('w')).toBe(false)
    expect(listWordEntries()).toHaveLength(0)
  })

  test('损坏的存储数据返回空列表', () => {
    localStorage.setItem('linguaai.vocab_words', '{invalid')
    expect(listWordEntries()).toEqual([])
    expect(isWordCollected('x')).toBe(false)
  })
})

describe('短语收录（与单词隔离）', () => {
  beforeEach(() => localStorage.clear())

  test('addPhraseEntry 持久化到短语表，不污染单词表', () => {
    addPhraseEntry({ text: 'pull an all-nighter', translation: '熬夜', articleId: 'a1', now: NOW })
    expect(isPhraseCollected('pull an all-nighter')).toBe(true)
    expect(isWordCollected('pull an all-nighter')).toBe(false)
    expect(listWordEntries()).toHaveLength(0)
    expect(listPhraseEntries()).toHaveLength(1)
  })

  test('removePhraseEntry 只移除短语', () => {
    addPhraseEntry({ text: 'p', articleId: 'a1', now: NOW })
    removePhraseEntry('p')
    expect(isPhraseCollected('p')).toBe(false)
  })
})

describe('熟悉程度（5 颗心）', () => {
  beforeEach(() => localStorage.clear())

  test('无覆盖值时由算法计算：认识 stage2 → 4 心', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    rateWord('a1', 'w', 'known', NOW)
    rateWord('a1', 'w', 'known', NOW) // stage 0 → 1 → 2
    const record = aggregateLatestWordRecord('w')
    const entry = listWordEntries()[0]
    expect(familiarityOf(entry, record)).toBe(4)
  })

  test('未评且无覆盖值 → 0 心', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    const entry = listWordEntries()[0]
    expect(familiarityOf(entry, undefined)).toBe(0)
  })

  test('手动设置覆盖算法值并持久化；清除后恢复算法值', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    rateWord('a1', 'w', 'known', NOW) // 算法值 3 心

    setWordFamiliarity('w', 5)
    let entry = listWordEntries()[0]
    expect(entry.familiarity).toBe(5)
    expect(familiarityOf(entry, aggregateLatestWordRecord('w'))).toBe(5)

    // 清除覆盖（学习/复习新自评后的行为）
    setWordFamiliarity('w', null)
    entry = listWordEntries()[0]
    expect(entry.familiarity).toBeUndefined()
    expect(familiarityOf(entry, aggregateLatestWordRecord('w'))).toBe(3)
  })

  test('对未收录的词设置熟悉程度为空操作', () => {
    setWordFamiliarity('nope', 4)
    expect(isWordCollected('nope')).toBe(false)
    expect(listWordEntries()).toHaveLength(0)
  })

  test('短语与单词的熟悉程度互相隔离', () => {
    addWordEntry({ text: 'put off', articleId: 'a1', now: NOW })
    addPhraseEntry({ text: 'put off', articleId: 'a1', now: NOW })
    setWordFamiliarity('put off', 2)
    setPhraseFamiliarity('put off', 5)

    expect(listWordEntries()[0].familiarity).toBe(2)
    expect(listPhraseEntries()[0].familiarity).toBe(5)

    setWordFamiliarity('put off', null)
    expect(listPhraseEntries()[0].familiarity).toBe(5)
  })
})

describe('多源掌握程度聚合', () => {
  beforeEach(() => localStorage.clear())

  test('aggregateLatestWordRecord 取各来源中 ratedAt 最新的记录', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    addWordEntry({ text: 'w', articleId: 'a2', now: NOW })
    rateWord('a1', 'w', 'known', new Date('2026-09-01T10:00:00'))
    const latest = rateWord('a2', 'w', 'unknown', new Date('2026-09-04T10:00:00'))

    const record = aggregateLatestWordRecord('w')
    expect(record).toEqual(latest)
    expect(record?.rating).toBe('unknown')
  })

  test('未收录的词聚合返回 undefined', () => {
    expect(aggregateLatestWordRecord('nope')).toBeUndefined()
  })

  test('已收录但所有来源无进度记录时返回 undefined', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    expect(aggregateLatestWordRecord('w')).toBeUndefined()
  })

  test('getWordSourceRecords 返回所有来源的进度记录', () => {
    addWordEntry({ text: 'w', articleId: 'a1', now: NOW })
    addWordEntry({ text: 'w', articleId: 'a2', now: NOW })
    rateWord('a1', 'w', 'known', NOW)
    rateWord('a2', 'w', 'fuzzy', NOW)
    const records = getWordSourceRecords('w')
    expect(records).toHaveLength(2)
  })

  test('短语聚合独立于单词', () => {
    addPhraseEntry({ text: 'p', articleId: 'a1', now: NOW })
    ratePhrase('a1', 'p', 'known', NOW)
    expect(aggregateLatestPhraseRecord('p')?.rating).toBe('known')
    expect(aggregateLatestWordRecord('p')).toBeUndefined()
  })
})
