/**
 * OpenAI 兼容真实适配器（mock / real 切换的 real 侧）
 * - 文字适配器：POST {baseUrl}/chat/completions，提示词约束 JSON 输出，
 *   宽松解析（容错代码围栏 / 单键对象包裹 / 前后杂文）
 * - 声音适配器：POST {baseUrl}/audio/speech，超长文本按句边界分块请求后拼接音频
 * 依赖注入：fetch 与音源时长探测均可在构造时替换（测试接缝，jsdom 不触发真实网络）
 */
import type { TextModelConfig, VoiceModelConfig } from '../aiConfig'
import { proxied } from './devProxy'
import type {
  PhraseEntry,
  Quiz,
  Sentence,
  TextAiAdapter,
  TtsResult,
  VoiceAiAdapter,
  WordEntry,
} from './types'

export type FetchLike = typeof fetch

export interface RealAdapterOptions {
  fetch?: FetchLike
  /** 探测音源真实时长（默认浏览器 Audio 元数据；失败由适配器兜底估算） */
  probeDurationMs?: (audioUrl: string) => Promise<number>
}

/* ---- 通用工具 ---- */

function assertNonEmptyText(text: string, label: string): void {
  if (!text.trim()) {
    throw new Error(`${label}不能为空`)
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** 错误详情截断，保持步骤错误信息可读 */
function brief(text: string): string {
  const trimmed = text.trim()
  return trimmed ? `：${trimmed.slice(0, 120)}` : ''
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** 单键对象解包：{"words":[...]} → [...]（模型常见的包裹形态） */
function unwrapSingleArray(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const values = Object.values(value)
    if (values.length === 1 && Array.isArray(values[0])) return values[0]
  }
  return value
}

/**
 * 从 LLM 回复文本中宽松提取 JSON：
 * ① 剥 ```json 围栏后直接解析；② 截取首个 [ / { 起始的片段再解析
 */
export function parseJsonLoose<T>(raw: string): T {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const direct = tryParse(unfenced)
  if (direct !== undefined) return unwrapSingleArray(direct) as T

  const start = unfenced.search(/[[{]/)
  if (start !== -1) {
    const end = Math.max(unfenced.lastIndexOf(']'), unfenced.lastIndexOf('}'))
    const sliced = tryParse(unfenced.slice(start, end + 1))
    if (sliced !== undefined) return unwrapSingleArray(sliced) as T
  }
  throw new Error('模型返回的内容不是合法 JSON，请重试')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 字段宽松归一：缺失的字符串字段补空串，近义词缺失补空数组 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/* ---- 文字模型提示词 ---- */

const WORDS_INSTRUCTION = `你是英语学习助教。从用户提供的英文文章中提取最多 30 个最值得中国学习者学习的生词（按学习价值排序）。
只输出一个 JSON 数组，每个元素格式如下，不要输出任何其他文字：
{"word":"单词原形","phonetic":"/IPA 音标/","partOfSpeech":"词性缩写（如 n. / v. / adj.）","definition":"简短英文释义","translation":"中文释义","example":"一个使用该词的英文例句","synonyms":["近义词"]}`

const PHRASES_INSTRUCTION = `你是英语学习助教。从用户提供的英文文章中提取最多 10 个重点短语（按学习价值排序）。
只输出一个 JSON 数组，每个元素格式如下，不要输出任何其他文字：
{"phrase":"英文短语","definition":"简短英文释义","translation":"中文释义","example":"一个使用该短语的英文例句"}`

const SENTENCES_INSTRUCTION = `把用户提供的英文文章按自然句切分（保留原文，不增删改写任何词），并给出每句的中文翻译。
只输出一个 JSON 数组，每个元素格式如下，不要输出任何其他文字：
{"text":"原句（含句末标点）","translation":"中文翻译"}`

const QUIZ_INSTRUCTION = `你是英语听力理解出题人。基于用户提供的英文文章出 3 道理解题：恰好 1 道单选题、1 道填空题、1 道判断正误题。题目与解析用中文，答案引用原文。
只输出一个 JSON 数组，每个元素格式如下，不要输出任何其他文字：
单选题 {"type":"single-choice","question":"中文题面","options":["选项A","选项B","选项C","选项D"],"answer":"正确选项（必须与 options 中一项完全一致）","explanation":"中文解析"}
填空题 {"type":"fill-blank","question":"中文题面，其中待填部分用 ______ 表示","answer":"英文答案","explanation":"中文解析"}
判断题 {"type":"true-false","question":"中文陈述句","answer":true,"explanation":"中文解析"}`

/* ---- 文字适配器 ---- */

export class OpenAiTextAdapter implements TextAiAdapter {
  readonly config: TextModelConfig
  private readonly fetchImpl: FetchLike

  constructor(config: TextModelConfig, options: RealAdapterOptions = {}) {
    this.config = config
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args))
  }

  /** 发起对话补全请求并宽松解析 JSON 输出 */
  private async chatJson(content: string, instruction: string): Promise<unknown> {
    const response = await this.fetchImpl(proxied(`${trimSlash(this.config.baseUrl)}/chat/completions`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: [
          { role: 'system', content: `${instruction}\n只输出 JSON，不要输出任何其他文字。` },
          { role: 'user', content },
        ],
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`文字模型请求失败（HTTP ${response.status}）${brief(detail)}`)
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const message = payload?.choices?.[0]?.message?.content
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('模型未返回内容，请重试')
    }
    return parseJsonLoose(message)
  }

  async extractWords(content: string): Promise<WordEntry[]> {
    assertNonEmptyText(content, '文章内容')
    const data = await this.chatJson(content, WORDS_INSTRUCTION)
    if (!Array.isArray(data)) throw new Error('生词提取结果格式不正确，请重试')
    return data
      .filter(isRecord)
      .map((item) => ({
        word: str(item.word).trim(),
        phonetic: str(item.phonetic),
        partOfSpeech: str(item.partOfSpeech),
        definition: str(item.definition),
        translation: str(item.translation),
        example: str(item.example),
        synonyms: strArray(item.synonyms),
      }))
      .filter((entry) => entry.word.length > 0)
  }

  async extractPhrases(content: string): Promise<PhraseEntry[]> {
    assertNonEmptyText(content, '文章内容')
    const data = await this.chatJson(content, PHRASES_INSTRUCTION)
    if (!Array.isArray(data)) throw new Error('短语提取结果格式不正确，请重试')
    return data
      .filter(isRecord)
      .map((item) => ({
        phrase: str(item.phrase).trim(),
        definition: str(item.definition),
        translation: str(item.translation),
        example: str(item.example),
      }))
      .filter((entry) => entry.phrase.length > 0)
  }

  async splitSentences(content: string): Promise<Sentence[]> {
    assertNonEmptyText(content, '文章内容')
    const data = await this.chatJson(content, SENTENCES_INSTRUCTION)
    if (!Array.isArray(data)) throw new Error('分句结果格式不正确，请重试')
    const items = data
      .filter(isRecord)
      .map((item) => ({ text: str(item.text).trim(), translation: str(item.translation) }))
      .filter((item) => item.text.length > 0)
    return estimateTimeline(items)
  }

  async generateQuiz(content: string): Promise<Quiz[]> {
    assertNonEmptyText(content, '文章内容')
    const data = await this.chatJson(content, QUIZ_INSTRUCTION)
    if (!Array.isArray(data)) throw new Error('出题结果格式不正确，请重试')
    return data.filter(isQuiz)
  }
}

/**
 * 句级时间轴估算：按字符长度比例分配（管道随后会等比缩放到 TTS 真实时长，
 * 因此绝对数值只需保证单调连续、相对比例合理）
 */
function estimateTimeline(items: Array<{ text: string; translation: string }>): Sentence[] {
  const MS_PER_CHAR = 50
  let cursor = 0
  return items.map((item) => {
    const duration = Math.max(1, item.text.length * MS_PER_CHAR)
    const sentence: Sentence = { ...item, startMs: cursor, endMs: cursor + duration }
    cursor += duration
    return sentence
  })
}

/** 题目结构校验：字段齐备才进入渲染判分，避免脏数据炸页面 */
function isQuiz(value: unknown): value is Quiz {
  if (!isRecord(value)) return false
  const explanation = str(value.explanation)
  const question = str(value.question)
  if (!question || !explanation) return false
  if (value.type === 'single-choice') {
    const options = strArray(value.options)
    return options.length >= 2 && options.includes(str(value.answer))
  }
  if (value.type === 'fill-blank') {
    return question.includes('______') && !!str(value.answer)
  }
  if (value.type === 'true-false') {
    return typeof value.answer === 'boolean'
  }
  return false
}

/* ---- 声音适配器 ---- */

/** OpenAI TTS 单次请求的输入上限（官方 4096，留余量） */
const TTS_MAX_CHARS = 4000

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
}

/**
 * 超长文本按句边界分块：整句尽量打包，单句超限再按空格硬切
 */
export function splitForTts(text: string, maxChars: number): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return [trimmed]

  const sentences = trimmed.match(/[^.!?]+[.!?]*\s*/g) ?? [trimmed]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // 单句超限：按空格硬切
      let rest = sentence
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(' ', maxChars)
        if (cut <= 0) cut = maxChars
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut)
      }
      current = rest
    } else {
      if (current.length + sentence.length > maxChars && current) {
        chunks.push(current.trim())
        current = ''
      }
      current += sentence
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [trimmed]
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('音频数据读取失败'))
    reader.readAsDataURL(blob)
  })
}

/** 兜底时长估算：与 mock 同口径（词数 × 380ms ÷ 语速） */
function estimateDurationMs(text: string, speed: number): number {
  const wordCount = text.trim().split(/\s+/).length
  return Math.round(Math.max(600, wordCount * 380) / speed)
}

/** 默认时长探测：浏览器 Audio 元数据（5s 超时，失败返回 0 走估算兜底） */
async function probeViaAudioElement(audioUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio()
    const finish = (ms: number) => {
      window.clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('error', onError)
      audio.src = ''
      resolve(ms)
    }
    const onLoaded = () =>
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0)
    const onError = () => finish(0)
    const timer = window.setTimeout(() => finish(0), 5000)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('error', onError)
    audio.preload = 'metadata'
    audio.src = audioUrl
  })
}

export class OpenAiVoiceAdapter implements VoiceAiAdapter {
  readonly config: VoiceModelConfig
  private readonly fetchImpl: FetchLike
  private readonly probeDurationMs: (audioUrl: string) => Promise<number>

  constructor(config: VoiceModelConfig, options: RealAdapterOptions = {}) {
    this.config = config
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args))
    this.probeDurationMs = options.probeDurationMs ?? probeViaAudioElement
  }

  /** 单块语音合成请求（OpenAI /audio/speech） */
  private async requestSpeech(chunk: string): Promise<Blob> {
    const response = await this.fetchImpl(proxied(`${trimSlash(this.config.baseUrl)}/audio/speech`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        voice: this.config.voiceType,
        input: chunk,
        speed: this.config.speed,
        response_format: this.config.audioFormat,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`语音合成失败（HTTP ${response.status}）${brief(detail)}`)
    }
    return response.blob()
  }

  async synthesize(text: string): Promise<TtsResult> {
    assertNonEmptyText(text, '待合成文本')
    const mimeType = AUDIO_MIME[this.config.audioFormat] ?? 'audio/mpeg'
    const chunks = splitForTts(text, TTS_MAX_CHARS)
    const blobs: Blob[] = []
    for (const chunk of chunks) {
      blobs.push(await this.requestSpeech(chunk))
    }
    const audioUrl = await blobToDataUri(new Blob(blobs, { type: mimeType }))
    const probed = await this.probeDurationMs(audioUrl)
    const durationMs = probed > 0 ? probed : estimateDurationMs(text, this.config.speed)
    return { audioUrl, mimeType, durationMs }
  }

  async synthesizeAll(texts: string[]): Promise<TtsResult[]> {
    return Promise.all(texts.map((text) => this.synthesize(text)))
  }
}
