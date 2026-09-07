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

/** 统计一组文本项的总字符数 */
function totalChars(items: PdfTextItem[]): number {
  return items.reduce((s, i) => s + i.str.length, 0)
}

/**
 * 检测双栏分界：全局 item 起始 x 排序后找最大间隙，>15 单位视为栏分界。
 * 生词/注释边栏与正文的间隙可能只有 ~20 单位（正文行较长时），
 * 阈值需足够小才能识别；配合 reconstructLines 的字符比例判定排除误判。
 */
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
  return maxGap > 15 ? midpoint : null
}

/** 全文档阅读顺序重建：逐页检测栏数，双栏先左后右；边栏（字符数极少）直接排除 */
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
      continue
    }
    const leftItems = pageItems.filter((i) => i.x < boundary)
    const rightItems = pageItems.filter((i) => i.x >= boundary)
    const leftChars = totalChars(leftItems)
    const rightChars = totalChars(rightItems)
    const minChars = Math.min(leftChars, rightChars)
    const maxChars = Math.max(leftChars, rightChars)
    // 一栏字符数不足另一栏 20% → 视为边栏（生词注释/页眉等），只保留主栏
    if (maxChars > 0 && minChars / maxChars < 0.2) {
      const mainItems = leftChars >= rightChars ? leftItems : rightItems
      allLines.push(...groupPageLines(mainItems))
    } else {
      allLines.push(...groupPageLines(leftItems), ...groupPageLines(rightItems))
    }
  }
  return allLines
}

// ---------------------------------------------------------------------------
// 内部：版面杂质清洗
// ---------------------------------------------------------------------------

/**
 * 判断是否为生词栏词性标记行：如「n.」「adj.」「v.扔掉」「n.心理疗法」。
 * 生词/注释边栏的每条词义通常以英文词性缩写 + 句点开头，正文不会出现此形态。
 */
function isVocabPosLine(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // 词性缩写 + 句点，后跟结尾 / 括号 / 中文 / CJK 部首（生词栏释义）
  return /^(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|aux|abbr)\.($|\(|[\u4e00-\u9fff\u2e80-\u2fdf\uff00-\uffef])/i.test(t)
}

/** 剔除跨页重复行（页眉/页脚）、纯数字行（页码）与生词栏词性标记行 */
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
    if (isVocabPosLine(text)) return false
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
