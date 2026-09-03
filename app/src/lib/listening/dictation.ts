/**
 * 逐句精听听写 — 纯函数域（工单 #9）
 * 挖空由文章生词/重点短语数据驱动（三档难度），判分忽略大小写与空格等容错
 * 页面与测试只依赖这里的纯函数，不感知数据来源
 */
import type { PhraseEntry, WordEntry } from '../ai/types'

/** 听写难度：全部听写 / 重要词语（默认）/ 仅生词 */
export type DictationDifficulty = 'full' | 'key' | 'new'

export const DICTATION_DIFFICULTY_LABELS: Record<DictationDifficulty, string> = {
  full: '全部听写',
  key: '重要词语',
  new: '仅生词',
}

/** 文章词汇数据（挖空依据） */
export interface DictationVocab {
  words: string[]
  phrases: string[]
}

/** 由处理产物构造词汇数据 */
export function vocabFromProcessing(
  words: WordEntry[] = [],
  phrases: PhraseEntry[] = [],
): DictationVocab {
  return { words: words.map((w) => w.word), phrases: phrases.map((p) => p.phrase) }
}

/** 句子切分后的片段：文本片段或挖空（answer 为原始拼写） */
export interface DictationSegment {
  kind: 'text' | 'blank'
  /** 文本片段内容 / 挖空答案 */
  text: string
  /** 挖空序号（text 片段为 -1） */
  blankIndex: number
}

export interface SentenceDictation {
  segments: DictationSegment[]
  /** 按序的挖空答案（输入框数 = 答案字母数） */
  blanks: string[]
}

/** 词元（字母/数字/连字符/撇号）与分隔符（空格、标点） */
interface RawToken {
  kind: 'word' | 'sep'
  raw: string
}

const WORD_RE = /[A-Za-z0-9'’-]+/g

export function tokenize(text: string): RawToken[] {
  const tokens: RawToken[] = []
  let last = 0
  for (const match of text.matchAll(WORD_RE)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: 'sep', raw: text.slice(last, index) })
    tokens.push({ kind: 'word', raw: match[0] })
    last = index + match[0].length
  }
  if (last < text.length) tokens.push({ kind: 'sep', raw: text.slice(last) })
  return tokens
}

/** 生词集合（小写归一） */
function vocabWordSet(vocab: DictationVocab): Set<string> {
  const set = new Set<string>()
  for (const word of vocab.words) set.add(word.toLowerCase().trim())
  return set
}

/** 重要词语集合 = 生词 ∪ 短语中的词元（小写归一） */
function vocabKeySet(vocab: DictationVocab): Set<string> {
  const set = vocabWordSet(vocab)
  for (const phrase of vocab.phrases) {
    for (const token of tokenize(phrase)) {
      if (token.kind === 'word') set.add(token.raw.toLowerCase())
    }
  }
  return set
}

/**
 * 由句子文本 + 词汇数据 + 难度构造听写片段序列：
 * full 挖所有词元；key 挖生词与重点短语词元；new 仅挖生词。
 * 无命中词元时 blanks 为空（页面提示切换难度或跳过本句）。
 */
export function buildSentenceDictation(
  text: string,
  vocab: DictationVocab,
  difficulty: DictationDifficulty,
): SentenceDictation {
  const targets =
    difficulty === 'new' ? vocabWordSet(vocab) : difficulty === 'key' ? vocabKeySet(vocab) : null

  const segments: DictationSegment[] = []
  const blanks: string[] = []
  let textBuffer = ''

  for (const token of tokenize(text)) {
    if (token.kind === 'word' && (targets === null || targets.has(token.raw.toLowerCase()))) {
      if (textBuffer) {
        segments.push({ kind: 'text', text: textBuffer, blankIndex: -1 })
        textBuffer = ''
      }
      segments.push({ kind: 'blank', text: token.raw, blankIndex: blanks.length })
      blanks.push(token.raw)
    } else {
      textBuffer += token.raw
    }
  }
  if (textBuffer) segments.push({ kind: 'text', text: textBuffer, blankIndex: -1 })

  return { segments, blanks }
}

/** 判分归一：去空格 + 小写（容错规则：忽略大小写与多余空格） */
export function normalizeForGrading(input: string): string {
  return input.replace(/\s+/g, '').toLowerCase()
}

/** 单空判分：归一后逐字符一致为正确 */
export function gradeBlank(answer: string, input: string): boolean {
  return normalizeForGrading(input) === normalizeForGrading(answer)
}

export interface BlankGrade {
  answer: string
  input: string
  correct: boolean
}

export interface SubmissionGrade {
  blanks: BlankGrade[]
  correctCount: number
  totalCount: number
  allCorrect: boolean
}

/** 整句判分：逐空独立判分，汇总正确数与全对标记 */
export function gradeSubmission(answers: string[], inputs: string[]): SubmissionGrade {
  const blanks = answers.map((answer, i) => {
    const input = inputs[i] ?? ''
    return { answer, input, correct: gradeBlank(answer, input) }
  })
  const correctCount = blanks.filter((b) => b.correct).length
  return {
    blanks,
    correctCount,
    totalCount: answers.length,
    allCorrect: answers.length > 0 && correctCount === answers.length,
  }
}
