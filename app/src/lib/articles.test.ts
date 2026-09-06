import { describe, test, expect, beforeEach } from 'vitest'
import {
  loadArticles,
  saveArticle,
  getArticle,
  attachProcessing,
  clearArticles,
  deleteArticle,
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

  test('options.title 覆盖自动推导的标题', () => {
    const article = saveArticle('Some content here.', 'TED · Speaker', {
      title: 'My Custom Title',
    })
    expect(article.title).toBe('My Custom Title')
  })

  test('options.sourceUrl 写入 article.sourceUrl', () => {
    const url = 'https://www.ted.com/talks/some_talk'
    const article = saveArticle('Some content here.', 'TED · Speaker', {
      sourceUrl: url,
    })
    expect(article.sourceUrl).toBe(url)

    const loaded = loadArticles()
    expect(loaded[0].sourceUrl).toBe(url)
  })

  test('不传 options 时 sourceUrl 为 undefined（向后兼容）', () => {
    const article = saveArticle('Some content here.', '粘贴文本')
    expect(article.sourceUrl).toBeUndefined()
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

  test('deleteArticle 按 ID 删除单篇文章', () => {
    const a = saveArticle('First article.', '粘贴文本')
    const b = saveArticle('Second article.', 'test.txt')

    expect(deleteArticle(a.id)).toBe(true)

    const articles = loadArticles()
    expect(articles).toHaveLength(1)
    expect(articles[0].id).toBe(b.id)
  })

  test('deleteArticle ID 不存在时返回 false 且不修改存储', () => {
    saveArticle('Some content.', '粘贴文本')
    const before = loadArticles()

    expect(deleteArticle('nonexistent')).toBe(false)

    expect(loadArticles()).toEqual(before)
  })

  test('deleteArticle 不影响其他文章的 processing', () => {
    const a = saveArticle('First article.', '粘贴文本')
    const b = saveArticle('Second article.', '粘贴文本')
    const PROCESSING = {
      words: [],
      phrases: [],
      sentences: [{ text: 'Hi.', startMs: 0, endMs: 1000 }],
    }
    attachProcessing(b.id, PROCESSING)

    deleteArticle(a.id)

    const remaining = loadArticles()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].processing).toEqual(PROCESSING)
  })
})

describe('AI 处理产物持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const PROCESSING = {
    words: [
      {
        word: 'procrastination',
        phonetic: '/prəˌkræstɪˈneɪʃən/',
        partOfSpeech: 'n.',
        definition: 'The act of delaying tasks',
        translation: '拖延症',
        example: 'His procrastination led to panic.',
        synonyms: ['delay'],
      },
    ],
    phrases: [
      { phrase: 'instant gratification', definition: 'Immediate pleasure', translation: '即时满足', example: 'e' },
    ],
    sentences: [{ text: 'So I want to start with a story.', startMs: 0, endMs: 8000 }],
  }

  test('attachProcessing 关联产物到文章并持久化', () => {
    const article = saveArticle('Some content.', '粘贴文本')
    const updated = attachProcessing(article.id, PROCESSING)

    expect(updated?.processing).toEqual(PROCESSING)
    expect(getArticle(article.id)?.processing).toEqual(PROCESSING)
  })

  test('未处理的文章没有 processing 字段', () => {
    const article = saveArticle('Some content.', '粘贴文本')
    expect(getArticle(article.id)?.processing).toBeUndefined()
  })

  test('文章不存在时返回 undefined 且不写入', () => {
    expect(attachProcessing('nonexistent', PROCESSING)).toBeUndefined()
    expect(loadArticles()).toEqual([])
  })

  test('不影响其他文章', () => {
    const a = saveArticle('First article.', '粘贴文本')
    const b = saveArticle('Second article.', '粘贴文本')
    attachProcessing(a.id, PROCESSING)

    const articles = loadArticles()
    expect(articles.find((x) => x.id === b.id)?.processing).toBeUndefined()
    expect(articles.find((x) => x.id === a.id)?.processing).toEqual(PROCESSING)
  })
})
