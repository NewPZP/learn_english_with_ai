/**
 * PDF 解析类型定义
 * 纯函数模块：输入 pdf.js 提取的文本项（含坐标/字号），输出结构化文章
 */
import type { Sentence } from '../ai/types'

/** pdf.js 文本项：解析的最小输入单元 */
export interface PdfTextItem {
  str: string
  /** transform[4]：水平坐标 */
  x: number
  /** transform[5]：垂直坐标（PDF 坐标系，原点左下） */
  y: number
  /** 字号代理（transform 矩阵的缩放分量） */
  height: number
  /** 字体名称（用于区分标题/正文） */
  fontName: string
  /** 所属页码（0-based） */
  page: number
  /** pdf.js 原生字段：行尾换行标记 */
  hasEOL: boolean
}

/** 分组后的文本行 */
export interface TextLine {
  text: string
  x: number
  y: number
  height: number
  fontName: string
  page: number
}

/** 解析后的单篇文章 */
export interface ParsedArticle {
  title: string
  /** 英文正文（已剥离中文部分） */
  content: string
  /** 中文正文（用于编辑后重新对齐校验；对齐失败时仍保留） */
  chineseText: string
  /** 逐句列表（对齐成功时含 translation） */
  sentences: Sentence[]
  /** 是否成功提取译文 */
  hasTranslation: boolean
}

/** 解析结果 */
export interface ParseResult {
  articles: ParsedArticle[]
  warnings: string[]
}

/** 扫描版 PDF 等无法解析的情况 */
export interface ParseError {
  error: string
  message: string
}

/** 解析器返回：成功或错误 */
export type ParseOutput = ParseResult | ParseError

/** 判断是否为 ParseError */
export function isParseError(result: ParseOutput): result is ParseError {
  return 'error' in result
}

/** PDF 解析器接口：生产环境用 pdf.js，测试可注入假实现 */
export type PdfParser = (file: File) => Promise<ParseOutput>
