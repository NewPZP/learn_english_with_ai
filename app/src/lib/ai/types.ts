/**
 * AI 适配器层类型定义（PRD 测试接缝二）
 * 调用方只依赖这里的接口与数据结构，不感知具体供应商（mock / 真实 LLM / TTS）
 */

/** 生词条目（单词预习页数据源） */
export interface WordEntry {
  word: string
  /** IPA 音标，如 /prəˌkræstɪˈneɪʃən/ */
  phonetic: string
  /** 词性，如 n. / v. / adj. / adv. */
  partOfSpeech: string
  /** 英文释义 */
  definition: string
  /** 中文释义 */
  translation: string
  /** 例句（同一语域） */
  example: string
  /** 近义词 */
  synonyms: string[]
}

/** 短语条目 */
export interface PhraseEntry {
  phrase: string
  definition: string
  translation: string
  example: string
}

/** 分句结果（播客字幕 / 逐句精听数据源），时间轴相对音频起点 */
export interface Sentence {
  text: string
  startMs: number
  endMs: number
  /** 中文译文（逐句精听「显示译文」；早期数据可能缺失） */
  translation?: string
}

/** 智能出题：单选 */
export interface SingleChoiceQuiz {
  type: 'single-choice'
  question: string
  options: string[]
  /** 正确选项，必须是 options 中的一项 */
  answer: string
  explanation: string
}

/** 智能出题：填空 */
export interface FillBlankQuiz {
  type: 'fill-blank'
  /** 题面含 ______ 占位 */
  question: string
  answer: string
  explanation: string
}

/** 智能出题：判断正误 */
export interface TrueFalseQuiz {
  type: 'true-false'
  question: string
  answer: boolean
  explanation: string
}

/** 三种题型的判别联合 */
export type Quiz = SingleChoiceQuiz | FillBlankQuiz | TrueFalseQuiz

/** TTS 合成结果 */
export interface TtsResult {
  /** 可直接用于 <audio src> 的地址（mock 为 data URI，真实实现可为网络地址） */
  audioUrl: string
  mimeType: string
  durationMs: number
}

/** 文字模型适配器：应用内所有文字 AI 能力的唯一入口 */
export interface TextAiAdapter {
  /** 生词提取：返回单词 + 音标 + 中英释义 */
  extractWords(content: string): Promise<WordEntry[]>
  /** 短语提取：返回短语 + 释义 */
  extractPhrases(content: string): Promise<PhraseEntry[]>
  /** 句级分句：返回句子 + 时间轴（字幕示例） */
  splitSentences(content: string): Promise<Sentence[]>
  /** 智能出题：单选/填空/判断三题型 */
  generateQuiz(content: string): Promise<Quiz[]>
}

/** 声音模型适配器：应用内所有 TTS 能力的唯一入口 */
export interface VoiceAiAdapter {
  /** 合成单段文本 */
  synthesize(text: string): Promise<TtsResult>
  /** 按句列表批量合成，顺序与输入一致 */
  synthesizeAll(texts: string[]): Promise<TtsResult[]>
}
