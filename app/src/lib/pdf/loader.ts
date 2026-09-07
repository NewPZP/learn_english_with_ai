/**
 * PDF 文件加载器：动态导入 pdf.js，提取文本项，调用纯函数解析。
 * 按需加载，不进主 bundle。
 */
import type { ParseOutput, PdfTextItem } from './types'
import { parsePdfText } from './parse'

/** 从 File 对象解析 PDF：提取文本 → 纯函数解析 → 返回结构化文章 */
export async function loadPdf(file: File): Promise<ParseOutput> {
  // 动态导入，避免 pdf.js 进入主 bundle
  const pdfjs = await import('pdfjs-dist')
  // 禁用 worker（jsdom / 非浏览器环境兼容）；浏览器端可配置 worker 提升性能
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer, useWorkerFetch: false, isEvalSupported: false }).promise
  const items: PdfTextItem[] = []
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    const content = await page.getTextContent()
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const t = item.transform
      items.push({
        str: item.str,
        x: t[4],
        y: t[5],
        height: Math.hypot(t[2], t[3]),
        fontName: item.fontName ?? 'normal',
        page: i,
        hasEOL: (item as { hasEOL?: boolean }).hasEOL ?? false,
      })
    }
  }
  return parsePdfText(items)
}
