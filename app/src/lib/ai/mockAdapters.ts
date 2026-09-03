/**
 * Mock 适配器实现
 * - 文字适配器：不调用真实模型，确定性返回原型示例数据（结构稳定可作夹具）
 * - 声音适配器：按文本长度确定性生成可播放的 220Hz 正弦 WAV（data URI），语速取自配置
 * 真实 LLM/TTS 供应商接入时替换为对应实现，接口不变
 */
import type { TextModelConfig, VoiceModelConfig } from '../aiConfig'
import { MOCK_PHRASES, MOCK_QUIZZES_SETS, MOCK_SENTENCES, MOCK_WORDS } from './mockData'
import type {
  PhraseEntry,
  Quiz,
  Sentence,
  TextAiAdapter,
  TtsResult,
  VoiceAiAdapter,
  WordEntry,
} from './types'

function assertNonEmptyText(text: string, label: string): void {
  if (!text.trim()) {
    throw new Error(`${label}不能为空`)
  }
}

/** 深拷贝夹具，调用方修改返回值不影响后续调用 */
function clone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T
}

export class MockTextAdapter implements TextAiAdapter {
  readonly config: TextModelConfig
  /** 出题轮换游标：每次调用取下一套预设题库（新实例从第一套开始） */
  private quizCursor = 0

  constructor(config: TextModelConfig) {
    this.config = config
  }

  async extractWords(content: string): Promise<WordEntry[]> {
    assertNonEmptyText(content, '文章内容')
    return clone(MOCK_WORDS)
  }

  async extractPhrases(content: string): Promise<PhraseEntry[]> {
    assertNonEmptyText(content, '文章内容')
    return clone(MOCK_PHRASES)
  }

  async splitSentences(content: string): Promise<Sentence[]> {
    assertNonEmptyText(content, '文章内容')
    return clone(MOCK_SENTENCES)
  }

  async generateQuiz(content: string): Promise<Quiz[]> {
    assertNonEmptyText(content, '文章内容')
    const set = clone(MOCK_QUIZZES_SETS[this.quizCursor % MOCK_QUIZZES_SETS.length])
    this.quizCursor += 1
    return set
  }
}

const TONE_HZ = 220
const SAMPLE_RATE = 8000

/**
 * 生成固定时长的单声道 16-bit PCM WAV data URI。
 * 纯函数：同一时长恒定产出同一音频字节，保证 mock 确定性。
 */
function makeToneWavDataUri(durationMs: number): string {
  const sampleCount = Math.max(1, Math.round((durationMs / 1000) * SAMPLE_RATE))
  const dataBytes = sampleCount * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt 块长度
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true) // 字节率
  view.setUint16(32, 2, true) // 块对齐
  view.setUint16(34, 16, true) // 位深
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < sampleCount; i++) {
    const t = i / SAMPLE_RATE
    const sample = Math.round(Math.sin(2 * Math.PI * TONE_HZ * t) * 0.2 * 32767)
    view.setInt16(44 + i * 2, sample, true)
  }

  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

export class MockVoiceAdapter implements VoiceAiAdapter {
  readonly config: VoiceModelConfig

  constructor(config: VoiceModelConfig) {
    this.config = config
  }

  async synthesize(text: string): Promise<TtsResult> {
    assertNonEmptyText(text, '待合成文本')
    const wordCount = text.trim().split(/\s+/).length
    const baseMs = Math.max(600, wordCount * 380)
    const durationMs = Math.round(baseMs / this.config.speed)
    return {
      audioUrl: makeToneWavDataUri(durationMs),
      mimeType: 'audio/wav',
      durationMs,
    }
  }

  async synthesizeAll(texts: string[]): Promise<TtsResult[]> {
    return Promise.all(texts.map((text) => this.synthesize(text)))
  }
}
