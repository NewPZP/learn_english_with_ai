import { describe, test, expect, beforeEach } from 'vitest'
import {
  loadArticles,
  saveArticle,
  getArticle,
  clearArticles,
  countWords,
  estimateDifficulty,
  deriveTitle,
  MAX_ARTICLE_CHARS,
} from './articles'

describe('文章元数据纯函数', () => {
  test('countWords：按空白分词', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('hello world')).toBe(2)
    expect(countWords('  the  quick   brown fox  ')).toBe(4)
  })

  test('estimateDifficulty：平均词长分级', () => {
    // 短词 → Beginner
    expect(estimateDifficulty('the cat sat on a mat')).toBe('Beginner')
    // 长词 → Advanced
    expect(
      estimateDifficulty('extraordinarily sophisticated terminology characterizes this passage'),
    ).toBe('Advanced')
  })

  test('deriveTitle：取首句并截断', () => {
    expect(deriveTitle('Inside the Mind of a Master Procrastinator. Full text here.')).toBe(
      'Inside the Mind of a Master Procrastinator',
    )
    expect(deriveTitle('')).toBe('未命名文章')

    const long = 'word '.repeat(30).trim()
    expect(deriveTitle(long).length).toBeLessThanOrEqual(60)
    expect(deriveTitle(long).endsWith('...')).toBe(true)
  })
})

describe('文章持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('空存储返回空数组', () => {
    expect(loadArticles()).toEqual([])
  })

  test('保存后可读取，最新在前', () => {
    const first = saveArticle('First article text here.', '粘贴文本')
    const second = saveArticle('Second article text here.', 'test.txt')

    const articles = loadArticles()
    expect(articles).toHaveLength(2)
    expect(articles[0].id).toBe(second.id)
    expect(articles[1].id).toBe(first.id)
  })

  test('保存的文章包含推导元数据', () => {
    const article = saveArticle('The quick brown fox jumps over the lazy dog.', '粘贴文本')

    expect(article.id).toBeTruthy()
    expect(article.title).toBe('The quick brown fox jumps over the lazy dog')
    expect(article.wordCount).toBe(9)
    expect(article.source).toBe('粘贴文本')
    expect(article.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('超长内容截断到上限', () => {
    const article = saveArticle('x'.repeat(MAX_ARTICLE_CHARS + 1000), '粘贴文本')
    expect(article.content).toHaveLength(MAX_ARTICLE_CHARS)
  })

  test('getArticle 按 id 查找', () => {
    const saved = saveArticle('Some content.', '粘贴文本')
    expect(getArticle(saved.id)?.title).toBe('Some content')
    expect(getArticle('nonexistent')).toBeUndefined()
  })

  test('损坏的存储数据返回空数组', () => {
    localStorage.setItem('linguaai.articles', '{invalid')
    expect(loadArticles()).toEqual([])
  })

  test('clearArticles 清空', () => {
    saveArticle('text', '粘贴文本')
    clearArticles()
    expect(loadArticles()).toEqual([])
  })
})
