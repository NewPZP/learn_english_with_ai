/**
 * 真实 AI 适配器（mock / real 切换的 real 侧）
 * - 文字适配器（OpenAI 兼容）：POST {baseUrl}/chat/completions，提示词约束 JSON 输出，
 *   宽松解析（容错代码围栏 / 单键对象包裹 / 前后杂文）
 * - 声音适配器（OpenAI 兼容）：POST {baseUrl}/audio/speech，超长文本按句边界分块请求后拼接音频
 * - 声音适配器（火山豆包 TTS）：POST {baseUrl}/api/v3/tts/unidirectional，
 *   X-Api-Key 鉴权 + req_params 嵌套请求体，流式响应读完整音频
 * 依赖注入：fetch 与音源时长探测均可在构造时替换（测试接缝，jsdom 不触发真实网络）
 */
import type { TextModelConfig, VoiceModelConfig } from '../aiConfig'
import { proxied, randomRequestId } from './devProxy'
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

const QUIZ_INSTRUCTION = `You are an English listening comprehension quiz generator. Based on the English article provided by the user, create 3 comprehension questions: exactly 1 single-choice, 1 fill-in-the-blank, and 1 true/false question. All questions, options, answers, and explanations must be in English.
Output only a JSON array, each element in one of the following formats, with no other text:
Single choice: {"type":"single-choice","question":"English question","options":["A","B","C","D"],"answer":"The correct option (must exactly match one option)","explanation":"English explanation"}
Fill in the blank: {"type":"fill-blank","question":"English sentence with ______ as the blank placeholder","answer":"English answer","explanation":"English explanation"}
True/False: {"type":"true-false","question":"English statement","answer":true,"explanation":"English explanation"}`

const TRANSLATE_INSTRUCTION = `你是专业中英翻译。用户会提供一个英文句子的 JSON 数组，请按原句顺序把每个句子翻译成流畅自然的中文。
只输出一个 JSON 字符串数组（与输入顺序一一对应），不要输出任何其他文字。`

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
      choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>
    }
    const choice = payload?.choices?.[0]
    const message = choice?.message?.content
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('模型未返回内容，请重试')
    }
    try {
      return parseJsonLoose(message)
    } catch (err) {
      // finish_reason=length 表示输出被 max_tokens 截断，JSON 必然不完整
      if (choice?.finish_reason === 'length') {
        throw new Error('模型输出被 Max Tokens 截断，请在 AI 配置页调大 Max Tokens 后重试')
      }
      throw err
    }
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

  async translateSentences(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return []
    const data = await this.chatJson(JSON.stringify(texts), TRANSLATE_INSTRUCTION)
    if (!Array.isArray(data)) throw new Error('翻译结果格式不正确，请重试')
    const translations = data.filter((v): v is string => typeof v === 'string')
    // 数量不足时按序对齐（缺失位返回空串，由调用方保留旧译文）
    return texts.map((_, i) => translations[i] ?? '')
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

/* ---- 火山豆包 TTS 适配器 ---- */

/**
 * 火山单次请求文本上限按保守值切分（官方文档未明示大模型 TTS 的单请求上限，
 * 按句边界 500 字符分块可稳定工作；英文一句约 60–100 字符）
 */
const VOLCANO_TTS_MAX_CHARS = 500

/** 语速映射：应用 0.5–2.0 倍速 → 火山 speech_rate [-50, 100]（100=2x，-50=0.5x） */
export function speedToSpeechRate(speed: number): number {
  return Math.round((speed - 1) * 100)
}

/** 音频格式映射：火山仅支持 mp3 / ogg_opus（aac / flac 回落 mp3） */
function volcanoAudioFormat(format: string): 'mp3' | 'ogg_opus' {
  return format === 'opus' ? 'ogg_opus' : 'mp3'
}

const VOLCANO_AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg_opus: 'audio/ogg',
}

/**
 * 将 base64 字符串解码为 Uint8Array。
 * 火山 TTS 的 JSON 响应中 data 字段为 base64 编码的音频二进制，
 * 浏览器端用 atob 解码后需逐字节转 Uint8Array（atob 返回 Latin1 字符串）。
 */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const cleaned = base64.replace(/\s+/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export class VolcanoVoiceAdapter implements VoiceAiAdapter {
  readonly config: VoiceModelConfig
  private readonly fetchImpl: FetchLike
  private readonly probeDurationMs: (audioUrl: string) => Promise<number>

  constructor(config: VoiceModelConfig, options: RealAdapterOptions = {}) {
    this.config = config
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args))
    this.probeDurationMs = options.probeDurationMs ?? probeViaAudioElement
  }

  /** 单块语音合成请求（火山 /api/v3/tts/unidirectional，流式响应由 fetch 读完整） */
  private async requestSpeech(chunk: string): Promise<Blob> {
    const isIcl = this.config.voiceType.trim().toUpperCase().startsWith('ICL_')
    const format = volcanoAudioFormat(this.config.audioFormat)
    // ogg_opus 仅支持 48000 采样率，其他格式默认 24000
    const sampleRate = format === 'ogg_opus' ? 48000 : 24000
    const response = await this.fetchImpl(
      proxied(`${trimSlash(this.config.baseUrl)}/api/v3/tts/unidirectional`),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.config.apiKey,
          // X-Api-Resource-Id 根据音色自动判断：ICL 复刻音色用 seed-icl-2.0，否则 seed-tts-2.0
          'X-Api-Resource-Id': isIcl ? 'seed-icl-2.0' : 'seed-tts-2.0',
          'X-Api-Request-Id': randomRequestId(),
        },
        body: JSON.stringify({
          user: { uid: 'linguaai' },
          req_params: {
            text: chunk,
            speaker: this.config.voiceType,
            // model 字段仅复刻音色（ICL_ 前缀）需指定，值为模型版本 seed-icl-2.0
            // 普通音色不携带 model，使用服务端默认（seed-tts-2.0）
            ...(isIcl ? { model: 'seed-icl-2.0' } : {}),
            audio_params: {
              format,
              sample_rate: sampleRate,
              speech_rate: speedToSpeechRate(this.config.speed),
            },
          },
        }),
      },
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`语音合成失败（HTTP ${response.status}）${brief(detail)}`)
    }
    // 火山 TTS 单向流式接口返回多个 JSON chunk 直接拼接：
    // {"code":0,"message":"","data":"<base64分片1>"}{"code":0,"data":"<base64分片2>"}...
    // content-type 为 text/plain，整体不是合法 JSON，需逐个提取 data 字段的 base64 拼接
    const raw = await response.text()
    const dataRegex = /"data":"([^"]*)"/g
    const parts: string[] = []
    let m: RegExpExecArray | null
    while ((m = dataRegex.exec(raw)) !== null) {
      parts.push(m[1])
    }
    if (parts.length > 0) {
      const base64 = parts.join('')
      if (base64.length > 0) {
        const bytes = base64ToBytes(base64)
        return new Blob([bytes], { type: AUDIO_MIME[volcanoAudioFormat(this.config.audioFormat)] })
      }
    }
    // 检查是否为错误响应（code != 0）
    const codeMatch = raw.match(/"code":\s*(\d+)/)
    if (codeMatch && codeMatch[1] !== '0') {
      const msgMatch = raw.match(/"message":"([^"]*)"/)
      throw new Error(`语音合成失败${brief(msgMatch?.[1] ?? raw)}`)
    }
    // fallback：非 JSON 响应（理论上火山不会返回纯二进制，保留兜底）
    return new Blob([raw], { type: AUDIO_MIME[volcanoAudioFormat(this.config.audioFormat)] })
  }

  async synthesize(text: string): Promise<TtsResult> {
    assertNonEmptyText(text, '待合成文本')
    assertNonEmptyText(this.config.voiceType, '音色 ID（请在 AI 配置页填写）')
    const format = volcanoAudioFormat(this.config.audioFormat)
    const mimeType = VOLCANO_AUDIO_MIME[format]
    const chunks = splitForTts(text, VOLCANO_TTS_MAX_CHARS)
    const blobs: Blob[] = []
    for (const chunk of chunks) {
      blobs.push(await this.requestSpeech(chunk))
    }
    const audioUrl = await blobToDataUri(new Blob(blobs, { type: mimeType }))
    const probed = await this.probeDurationMs(audioUrl)
    const durationMs = probed > 0 ? probed : estimateDurationMs(text, this.config.speed)
    return { audioUrl, mimeType, durationMs }
  }

  /** 逐条串行合成：火山 TTS 有较严格的并发限制，避免同时突发多请求 */
  async synthesizeAll(texts: string[]): Promise<TtsResult[]> {
    const results: TtsResult[] = []
    for (const text of texts) {
      results.push(await this.synthesize(text))
    }
    return results
  }
}
