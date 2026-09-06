import { describe, test, expect, beforeEach } from 'vitest'
import { loadSettings, saveSettings, setAutoCollectRatings } from './settings'

describe('学习设置', () => {
  beforeEach(() => localStorage.clear())

  test('默认 autoCollectRatings 为空数组（关闭自动收录）', () => {
    expect(loadSettings()).toEqual({ autoCollectRatings: [] })
  })

  test('setAutoCollectRatings 去重并持久化', () => {
    const updated = setAutoCollectRatings(['unknown', 'fuzzy', 'unknown'])
    expect(updated.autoCollectRatings).toEqual(['unknown', 'fuzzy'])
    expect(loadSettings().autoCollectRatings).toEqual(['unknown', 'fuzzy'])
  })

  test('saveSettings 整体覆写', () => {
    saveSettings({ autoCollectRatings: ['known'] })
    expect(loadSettings().autoCollectRatings).toEqual(['known'])
  })

  test('设为空数组即关闭自动收录', () => {
    setAutoCollectRatings(['unknown'])
    setAutoCollectRatings([])
    expect(loadSettings().autoCollectRatings).toEqual([])
  })

  test('损坏的存储数据回退到默认设置', () => {
    localStorage.setItem('linguaai.settings', '{invalid')
    expect(loadSettings()).toEqual({ autoCollectRatings: [] })
  })

  test('loadSettings 返回新对象，外部 mutation 不污染内部状态', () => {
    const a = loadSettings()
    a.autoCollectRatings.push('known')
    expect(loadSettings().autoCollectRatings).toEqual([])
  })
})
