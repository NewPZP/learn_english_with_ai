import { describe, test, expect } from 'vitest'
import {
  parsePdfText,
  isChineseText,
  isEnglishText,
  splitIntoSentences,
  splitChineseIntoSentences,
  alignTranslations,
  type PdfTextItem,
} from './parse'
import { isParseError } from './types'

/** 构造文本项的辅助函数 */
function item(
  str: string,
  opts: Partial<PdfTextItem> = {},
): PdfTextItem {
  return {
    str,
    x: opts.x ?? 50,
    y: opts.y ?? 700,
    height: opts.height ?? 12,
    fontName: opts.fontName ?? 'normal',
    page: opts.page ?? 0,
    hasEOL: opts.hasEOL ?? true,
  }
}

/** 构造一个标题行（大字号） */
function titleItem(str: string, opts: Partial<PdfTextItem> = {}): PdfTextItem {
  return item(str, { height: 24, fontName: 'bold', ...opts })
}

/** 构造多行正文文本项（单栏，逐行递减 y） */
function bodyLines(
  lines: string[],
  opts: { page?: number; startX?: number; startY?: number; lineHeight?: number; height?: number } = {},
): PdfTextItem[] {
  const { page = 0, startX = 50, startY = 700, lineHeight = 16, height = 12 } = opts
  return lines.map((str, i) =>
    item(str, { x: startX, y: startY - i * lineHeight, height, page, hasEOL: true }),
  )
}

describe('语言检测纯函数', () => {
  test('isChineseText：含中文字符返回 true', () => {
    expect(isChineseText('学习是一段终身的旅程')).toBe(true)
    expect(isChineseText('学习 learning 混合')).toBe(true)
    expect(isChineseText('pure English')).toBe(false)
    expect(isChineseText('')).toBe(false)
  })

  test('isEnglishText：英文字符占比高于中文返回 true', () => {
    expect(isEnglishText('Learning is a lifelong journey.')).toBe(true)
    expect(isEnglishText('学习是一段终身的旅程。')).toBe(false)
    expect(isEnglishText('')).toBe(false)
  })
})

describe('句子切分纯函数', () => {
  test('splitIntoSentences：英文按句末标点切分', () => {
    const result = splitIntoSentences('Hello world. This is a test! Is it working?')
    expect(result).toEqual(['Hello world.', 'This is a test!', 'Is it working?'])
  })

  test('splitIntoSentences：无标点的单句', () => {
    expect(splitIntoSentences('No punctuation here')).toEqual(['No punctuation here'])
  })

  test('splitChineseIntoSentences：中文按句号/问号/叹号切分', () => {
    const result = splitChineseIntoSentences('你好世界。这是一个测试！行吗？')
    expect(result).toEqual(['你好世界。', '这是一个测试！', '行吗？'])
  })

  test('splitChineseIntoSentences：无标点的单句', () => {
    expect(splitChineseIntoSentences('没有标点的一句话')).toEqual(['没有标点的一句话'])
  })
})

describe('译文对齐纯函数', () => {
  test('句数严格相等时逐句配对', () => {
    const en = ['Hello world.', 'This is a test.']
    const zh = ['你好世界。', '这是一个测试。']
    const result = alignTranslations(en, zh)
    expect(result.aligned).toBe(true)
    expect(result.sentences).toHaveLength(2)
    expect(result.sentences[0].text).toBe('Hello world.')
    expect(result.sentences[0].translation).toBe('你好世界。')
    expect(result.sentences[1].text).toBe('This is a test.')
    expect(result.sentences[1].translation).toBe('这是一个测试。')
  })

  test('句数不等时降级：aligned=false', () => {
    const en = ['Hello world.', 'This is a test.', 'Extra sentence.']
    const zh = ['你好世界。', '这是一个测试。']
    const result = alignTranslations(en, zh)
    expect(result.aligned).toBe(false)
    expect(result.sentences).toEqual([])
  })

  test('空数组对齐：0=0，aligned=true', () => {
    const result = alignTranslations([], [])
    expect(result.aligned).toBe(true)
    expect(result.sentences).toEqual([])
  })
})

describe('parsePdfText：扫描版 PDF', () => {
  test('空文本项返回扫描版错误', () => {
    const result = parsePdfText([])
    expect(isParseError(result)).toBe(true)
    if (isParseError(result)) {
      expect(result.error).toBe('scanned')
      expect(result.message).toContain('扫描版')
    }
  })
})

describe('parsePdfText：单篇英文 PDF', () => {
  test('单篇纯英文文章，无标题行', () => {
    const items = bodyLines([
      'Learning is a lifelong journey.',
      'It requires patience and dedication.',
      'Every expert was once a beginner.',
    ])
    const result = parsePdfText(items)
    expect(isParseError(result)).toBe(false)
    if (!isParseError(result)) {
      expect(result.articles).toHaveLength(1)
      const article = result.articles[0]
      expect(article.content).toContain('Learning is a lifelong journey.')
      expect(article.content).toContain('It requires patience and dedication.')
      expect(article.hasTranslation).toBe(false)
      expect(article.sentences).toEqual([])
    }
  })

  test('单篇英文文章含标题行', () => {
    const items = [
      titleItem('The Art of Learning', { y: 720 }),
      ...bodyLines(['Learning is a lifelong journey.', 'It requires patience.'], { startY: 680 }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      expect(result.articles).toHaveLength(1)
      expect(result.articles[0].title).toBe('The Art of Learning')
    }
  })
})

describe('parsePdfText：多篇文章 PDF', () => {
  test('按标题行切分出两篇文章', () => {
    const items = [
      titleItem('First Article', { y: 720 }),
      ...bodyLines(['First paragraph here.', 'Second line.'], { startY: 680, page: 0 }),
      titleItem('Second Article', { y: 600 }),
      ...bodyLines(['Another paragraph.', 'More text.'], { startY: 560, page: 0 }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      expect(result.articles).toHaveLength(2)
      expect(result.articles[0].title).toBe('First Article')
      expect(result.articles[0].content).toContain('First paragraph here.')
      expect(result.articles[1].title).toBe('Second Article')
      expect(result.articles[1].content).toContain('Another paragraph.')
    }
  })
})

describe('parsePdfText：双语段落交替', () => {
  test('英中段落交替，句数相等 → 逐句对齐', () => {
    const items = [
      titleItem('The Art of Learning', { y: 720 }),
      titleItem('学习的艺术', { y: 700 }),
      ...bodyLines(
        ['Learning is a lifelong journey.', '学习是一段终身的旅程。'],
        { startY: 680, lineHeight: 16 },
      ),
      ...bodyLines(
        ['It requires patience.', '它需要耐心。'],
        { startY: 648, lineHeight: 16 },
      ),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      expect(result.articles).toHaveLength(1)
      const article = result.articles[0]
      expect(article.hasTranslation).toBe(true)
      expect(article.sentences).toHaveLength(2)
      expect(article.sentences[0].text).toBe('Learning is a lifelong journey.')
      expect(article.sentences[0].translation).toBe('学习是一段终身的旅程。')
      expect(article.sentences[1].text).toBe('It requires patience.')
      expect(article.sentences[1].translation).toBe('它需要耐心。')
      // content 只存英文
      expect(article.content).not.toContain('学习')
    }
  })

  test('英中段落交替，句数不等 → 整篇降级', () => {
    const items = [
      titleItem('The Art of Learning', { y: 720 }),
      titleItem('学习的艺术', { y: 700 }),
      ...bodyLines(
        ['Learning is a journey.', 'It requires patience.', 'And dedication.'],
        { startY: 680, lineHeight: 16 },
      ),
      ...bodyLines(['学习是一段旅程。', '它需要耐心。'], { startY: 632, lineHeight: 16 }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const article = result.articles[0]
      expect(article.hasTranslation).toBe(false)
      expect(article.sentences).toEqual([])
      // 英文仍保留在 content
      expect(article.content).toContain('And dedication.')
    }
  })
})

describe('parsePdfText：逐句对照', () => {
  test('英文句下紧跟中文，逐句对齐', () => {
    const items = [
      titleItem('Daily Learning', { y: 720 }),
      ...bodyLines(
        [
          'Learning is a lifelong journey.',
          '学习是一段终身的旅程。',
          'It requires patience.',
          '它需要耐心。',
        ],
        { startY: 680, lineHeight: 16 },
      ),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const article = result.articles[0]
      expect(article.hasTranslation).toBe(true)
      expect(article.sentences).toHaveLength(2)
      expect(article.sentences[0].translation).toBe('学习是一段终身的旅程。')
      expect(article.sentences[1].translation).toBe('它需要耐心。')
    }
  })
})

describe('parsePdfText：左右双栏', () => {
  test('英文左栏中文右栏，按坐标重组阅读顺序', () => {
    const page = 0
    const leftX = 50
    const rightX = 350
    const startY = 700
    const lh = 16
    const items: PdfTextItem[] = [
      titleItem('Bilingual Reading', { y: 720, page }),
      // 左栏英文
      item('Learning is a lifelong journey.', { x: leftX, y: startY, page }),
      item('It requires patience.', { x: leftX, y: startY - lh, page }),
      // 右栏中文
      item('学习是一段终身的旅程。', { x: rightX, y: startY, page }),
      item('它需要耐心。', { x: rightX, y: startY - lh, page }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const article = result.articles[0]
      expect(article.hasTranslation).toBe(true)
      expect(article.sentences).toHaveLength(2)
      expect(article.sentences[0].text).toBe('Learning is a lifelong journey.')
      expect(article.sentences[0].translation).toBe('学习是一段终身的旅程。')
    }
  })

  test('英文自身双栏（杂志式），无中文', () => {
    const page = 0
    const leftX = 50
    const rightX = 350
    const startY = 700
    const lh = 16
    const items: PdfTextItem[] = [
      titleItem('Magazine Article', { y: 720, page }),
      // 左栏
      item('First paragraph in left column.', { x: leftX, y: startY, page }),
      item('Second line in left column.', { x: leftX, y: startY - lh, page }),
      // 右栏
      item('Third paragraph in right column.', { x: rightX, y: startY, page }),
      item('Fourth line in right column.', { x: rightX, y: startY - lh, page }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const article = result.articles[0]
      expect(article.hasTranslation).toBe(false)
      // 左栏在前，右栏在后
      expect(article.content).toContain('First paragraph in left column.')
      expect(article.content).toContain('Third paragraph in right column.')
      const leftIdx = article.content.indexOf('First paragraph')
      const rightIdx = article.content.indexOf('Third paragraph')
      expect(leftIdx).toBeLessThan(rightIdx)
    }
  })
})

describe('parsePdfText：版面杂质清洗', () => {
  test('跨页重复的页眉被剔除', () => {
    const header = 'My Document Title - Page Header'
    const items = [
      // 页面 0
      item(header, { x: 50, y: 750, page: 0, height: 10 }),
      ...bodyLines(['Real content line one.', 'Real content line two.'], {
        startY: 700,
        page: 0,
      }),
      // 页面 1
      item(header, { x: 50, y: 750, page: 1, height: 10 }),
      ...bodyLines(['Real content line three.', 'Real content line four.'], {
        startY: 700,
        page: 1,
      }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const content = result.articles[0].content
      expect(content).not.toContain('Page Header')
      expect(content).toContain('Real content line one.')
      expect(content).toContain('Real content line four.')
    }
  })

  test('纯数字页码被剔除', () => {
    const items = [
      ...bodyLines(['Some content here.'], { startY: 700, page: 0 }),
      item('2', { x: 300, y: 50, page: 0, height: 10 }),
      ...bodyLines(['More content here.'], { startY: 700, page: 1 }),
      item('3', { x: 300, y: 50, page: 1, height: 10 }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const content = result.articles[0].content
      // 页码不应出现在正文中（作为独立行）
      const lines = content.split('\n')
      expect(lines).not.toContain('2')
      expect(lines).not.toContain('3')
    }
  })

  test('生词栏词性标记行被剔除（如 n./adj. 及词性+释义）', () => {
    const items = [
      ...bodyLines(['Learning is a lifelong journey.', 'It requires patience.'], {
        startY: 700,
        page: 0,
      }),
      item('n.', { x: 380, y: 500, page: 0 }),
      item('adj.耐心的', { x: 380, y: 480, page: 0 }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const content = result.articles[0].content
      expect(content).toContain('Learning is a lifelong journey.')
      expect(content).not.toContain('n.')
      expect(content).not.toContain('耐心的')
    }
  })

  test('右侧窄生词栏（字符占比 < 20%）被整体剔除', () => {
    const items = [
      titleItem('Bilingual Reading', { y: 720, page: 0 }),
      // 左栏正文（英文长句，x 从 14 延伸到 350）
      item('Learning is a lifelong journey that requires patience.', { x: 14, y: 700, page: 0 }),
      item('It takes dedication and consistent effort over time.', { x: 14, y: 684, page: 0 }),
      // 右栏生词（窄列，x=370，字符极少）
      item('journey', { x: 370, y: 700, page: 0 }),
      item('n.旅程', { x: 370, y: 684, page: 0 }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      const article = result.articles[0]
      expect(article.content).toContain('Learning is a lifelong journey')
      expect(article.content).not.toContain('n.旅程')
    }
  })
})

describe('parsePdfText：双语标题合并', () => {
  test('英文标题后紧跟中文标题行，合并为一个标题取英文', () => {
    const items = [
      titleItem('The Art of Learning', { y: 720 }),
      titleItem('学习的艺术', { y: 700 }),
      ...bodyLines(['Learning is a lifelong journey.', '学习是一段终身的旅程。'], {
        startY: 680,
        lineHeight: 16,
      }),
    ]
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      expect(result.articles).toHaveLength(1)
      expect(result.articles[0].title).toBe('The Art of Learning')
    }
  })
})

describe('parsePdfText：source 文件名', () => {
  test('解析结果不包含 source（由 UI 层填充）', () => {
    const items = bodyLines(['Just a simple text.'])
    const result = parsePdfText(items)
    if (!isParseError(result)) {
      expect(result.articles[0]).not.toHaveProperty('source')
    }
  })
})
