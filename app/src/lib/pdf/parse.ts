/**
 * PDF 解析纯函数：输入 pdf.js 提取的文本项（含坐标/字号），输出结构化文章。
 * 与 worker/parsers.ts 同款纯函数模式——不依赖任何运行时 API，vitest 可直接单测。
 */
import type { Sentence } from '../ai/types'
import type { ParseOutput, ParseResult, ParsedArticle, PdfTextItem, TextLine } from './types'

// ---------------------------------------------------------------------------
// 语言检测
// ---------------------------------------------------------------------------

/** 含中文字符（CJK 统一表意文字）返回 true */
export function isChineseText(str: string): boolean {
  return /[\u4e00-\u9fff]/.test(str)
}

/** 英文字母数量多于中文字符返回 true */
export function isEnglishText(str: string): boolean {
  const letters = (str.match(/[a-zA-Z]/g) || []).length
  const chinese = (str.match(/[\u4e00-\u9fff]/g) || []).length
  return letters > chinese
}

// ---------------------------------------------------------------------------
// 句子切分
// ---------------------------------------------------------------------------

/** 英文按句末标点（. ! ?）后跟空白来切分，保留标点 */
export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [trimmed]
}

/** 中文按句末标点（。！？）切分，保留标点 */
export function splitChineseIntoSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [trimmed]
}

// ---------------------------------------------------------------------------
// 译文对齐
// ---------------------------------------------------------------------------

/**
 * 严格数量相等才逐句配对；不等则降级（aligned=false, sentences=[]）。
 * 句数相等但语义错位（如一句对两句）无法检测——这是已知限制，由「严格相等」规则接受。
 */
export function alignTranslations(
  enSentences: string[],
  zhSentences: string[],
): { aligned: boolean; sentences: Sentence[] } {
  if (enSentences.length !== zhSentences.length) {
    return { aligned: false, sentences: [] }
  }
  if (enSentences.length === 0) {
    return { aligned: true, sentences: [] }
  }
  const sentences: Sentence[] = enSentences.map((text, i) => ({
    text,
    startMs: 0,
    endMs: 0,
    translation: zhSentences[i],
  }))
  return { aligned: true, sentences }
}

// ---------------------------------------------------------------------------
// 内部：文本行分组与阅读顺序重建
// ---------------------------------------------------------------------------

/** 将同页同 y（容差内）的文本项合并为一行；行内按 x 排序拼接 */
function makeLine(items: PdfTextItem[]): TextLine {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  return {
    text: sorted.map((i) => i.str).join('').trim(),
    x: sorted[0].x,
    y: items[0].y,
    height: items[0].height,
    fontName: items[0].fontName,
    page: items[0].page,
  }
}

/** 将单页文本项按 y 分组为行（y 降序 = 从上到下） */
function groupPageLines(items: PdfTextItem[]): TextLine[] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => {
    const yTol = Math.max(a.height, b.height) * 0.5
    if (Math.abs(a.y - b.y) > yTol) return b.y - a.y
    return a.x - b.x
  })
  const lines: TextLine[] = []
  let current: PdfTextItem[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1]
    const curr = sorted[i]
    const yTol = Math.max(prev.height, curr.height) * 0.5
    if (Math.abs(curr.y - prev.y) <= yTol) {
      current.push(curr)
    } else {
      lines.push(makeLine(current))
      current = [curr]
    }
  }
  if (current.length > 0) lines.push(makeLine(current))
  return lines
}

/** 检测双栏分界：在 x 坐标中找最大间隙，>100 视为双栏 */
function detectColumnBoundary(items: PdfTextItem[]): number | null {
  if (items.length < 4) return null
  const xs = items.map((i) => i.x).sort((a, b) => a - b)
  let maxGap = 0
  let midpoint = 0
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1]
    if (gap > maxGap) {
      maxGap = gap
      midpoint = xs[i - 1] + gap / 2
    }
  }
  return maxGap > 100 ? midpoint : null
}

/** 全文档阅读顺序重建：逐页检测栏数，双栏先左后右 */
function reconstructLines(items: PdfTextItem[]): TextLine[] {
  const byPage = new Map<number, PdfTextItem[]>()
  for (const item of items) {
    if (!byPage.has(item.page)) byPage.set(item.page, [])
    byPage.get(item.page)!.push(item)
  }
  const allLines: TextLine[] = []
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageItems = byPage.get(page)!
    const boundary = detectColumnBoundary(pageItems)
    if (boundary === null) {
      allLines.push(...groupPageLines(pageItems))
    } else {
      allLines.push(
        ...groupPageLines(pageItems.filter((i) => i.x < boundary)),
        ...groupPageLines(pageItems.filter((i) => i.x >= boundary)),
      )
    }
  }
  return allLines
}

// ---------------------------------------------------------------------------
// 内部：版面杂质清洗
// ---------------------------------------------------------------------------

/** 剔除跨页重复行（页眉/页脚）与纯数字行（页码） */
function cleanArtifacts(lines: TextLine[]): TextLine[] {
  const counts = new Map<string, Set<number>>()
  for (const line of lines) {
    const text = line.text.trim()
    if (!text) continue
    if (!counts.has(text)) counts.set(text, new Set())
    counts.get(text)!.add(line.page)
  }
  const repeated = new Set<string>()
  for (const [text, pages] of counts) {
    if (pages.size > 1) repeated.add(text)
  }
  return lines.filter((line) => {
    const text = line.text.trim()
    if (!text) return false
    if (repeated.has(text)) return false
    if (/^\d+$/.test(text)) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// 内部：文章切分与构建
// ---------------------------------------------------------------------------

/** 按标题行（字号显著大于中位数）切分文章；连续标题行（双语标题对）归入同篇 */
function splitByTitles(lines: TextLine[], titleThreshold: number): TextLine[][] {
  if (lines.length === 0) return []
  const articles: TextLine[][] = []
  let current: TextLine[] = []
  for (const line of lines) {
    const isTitle = line.height > titleThreshold
    const last = current[current.length - 1]
    const lastIsTitle = !!last && last.height > titleThreshold
    if (isTitle && last && !lastIsTitle) {
      articles.push(current)
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) articles.push(current)
  return articles
}

/** 从一组行构建一篇文章：提取标题、分离英中正文、尝试对齐译文 */
function buildArticle(lines: TextLine[], titleThreshold: number): ParsedArticle {
  const titleLines: TextLine[] = []
  const body: TextLine[] = []
  for (const line of lines) {
    if (line.height > titleThreshold) titleLines.push(line)
    else body.push(line)
  }
  // 双语标题合并：取首个英文标题行
  let title = '未命名文章'
  for (const t of titleLines) {
    if (isEnglishText(t.text)) {
      title = t.text
      break
    }
  }
  if (title === '未命名文章' && titleLines.length > 0) {
    title = titleLines[0].text
  }
  // 分离英文/中文正文行
  const enLines = body.filter((l) => isEnglishText(l.text))
  const zhLines = body.filter((l) => isChineseText(l.text) && !isEnglishText(l.text))
  const englishText = enLines.map((l) => l.text).join('\n')
  const chineseText = zhLines.map((l) => l.text).join('\n')
  // 尝试对齐
  let sentences: Sentence[] = []
  let hasTranslation = false
  if (englishText && chineseText) {
    const result = alignTranslations(
      splitIntoSentences(englishText),
      splitChineseIntoSentences(chineseText),
    )
    if (result.aligned) {
      sentences = result.sentences
      hasTranslation = true
    }
  }
  const content = englishText || body.map((l) => l.text).join('\n')
  return { title, content, chineseText, sentences, hasTranslation }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 解析 PDF 文本项为结构化文章数组。
 * 空输入 → 扫描版错误；否则重建阅读顺序 → 清洗杂质 → 按标题切分 → 构建文章（含双语对齐）。
 */
export function parsePdfText(items: PdfTextItem[]): ParseOutput {
  if (items.length === 0) {
    return { error: 'scanned', message: '扫描版 PDF 不支持，无法提取文本内容' }
  }
  const lines = reconstructLines(items)
  const cleaned = cleanArtifacts(lines)
  if (cleaned.length === 0) {
    return { error: 'scanned', message: '扫描版 PDF 不支持，无法提取文本内容' }
  }
  const heights = cleaned.map((l) => l.height).sort((a, b) => a - b)
  const median = heights[Math.floor((heights.length - 1) / 2)]
  const titleThreshold = median * 1.5
  const groups = splitByTitles(cleaned, titleThreshold)
  const articles = groups.map((g) => buildArticle(g, titleThreshold))
  const result: ParseResult = { articles, warnings: [] }
  return result
}
