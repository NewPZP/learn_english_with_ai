import { describe, test, expect, beforeEach } from 'vitest'
import {
  defaultTextConfig,
  defaultVoiceConfig,
  saveTextConfig,
  saveVoiceConfig,
  type VoiceModelConfig,
} from '../aiConfig'
import { getTextAdapter, getVoiceAdapter } from './index'
import { MockTextAdapter, MockVoiceAdapter } from './mockAdapters'
import type { Quiz, TextAiAdapter, VoiceAiAdapter } from './types'

/**
 * 工单「AI 服务适配器层」验收测试
 * 覆盖：入参校验、配置传递、mock 返回结构、确定性、接口接缝
 */
const CONTENT =
  'Inside the Mind of a Master Procrastinator. So I want to start with a story about a guy. He was a senior in college, and he was working on his thesis.'

describe('入参校验', () => {
  const textAdapter = new MockTextAdapter(defaultTextConfig)
  const voiceAdapter = new MockVoiceAdapter(defaultVoiceConfig)

  test.each(['', '   \n  '])('空内容 %j 时文字适配器各方法抛错', async (bad) => {
    await expect(textAdapter.extractWords(bad)).rejects.toThrow('文章内容不能为空')
    await expect(textAdapter.extractPhrases(bad)).rejects.toThrow('文章内容不能为空')
    await expect(textAdapter.splitSentences(bad)).rejects.toThrow('文章内容不能为空')
    await expect(textAdapter.generateQuiz(bad)).rejects.toThrow('文章内容不能为空')
  })

  test('空文本时 TTS 合成抛错', async () => {
    await expect(voiceAdapter.synthesize('')).rejects.toThrow('待合成文本不能为空')
    await expect(voiceAdapter.synthesize('   ')).rejects.toThrow('待合成文本不能为空')
  })
})

describe('mock 文字适配器返回结构', () => {
  const adapter: TextAiAdapter = new MockTextAdapter(defaultTextConfig)

  test('extractWords 返回 32 个生词，结构完整（单词+音标+中英释义）', async () => {
    const words = await adapter.extractWords(CONTENT)

    expect(words).toHaveLength(32)
    expect(words[0]).toMatchObject({
      word: 'procrastination',
      phonetic: '/prəˌkræstɪˈneɪʃən/',
      partOfSpeech: 'n.',
      translation: '拖延症',
    })
    for (const w of words) {
      expect(w.word).toBeTruthy()
      expect(w.phonetic).toMatch(/^\/.+\/$/)
      expect(w.partOfSpeech).toBeTruthy()
      expect(w.definition).toBeTruthy()
      expect(w.translation).toBeTruthy()
      expect(w.example).toBeTruthy()
      expect(Array.isArray(w.synonyms)).toBe(true)
      expect(w.synonyms.length).toBeGreaterThan(0)
    }
  })

  test('extractPhrases 返回 8 个短语，含 instant gratification', async () => {
    const phrases = await adapter.extractPhrases(CONTENT)

    expect(phrases).toHaveLength(8)
    const instant = phrases.find((p) => p.phrase === 'instant gratification')
    expect(instant).toMatchObject({ translation: '即时满足' })
    for (const p of phrases) {
      expect(p.definition).toBeTruthy()
      expect(p.translation).toBeTruthy()
      expect(p.example).toBeTruthy()
    }
  })

  test('splitSentences 返回句级分句，时间轴单调且连续', async () => {
    const sentences = await adapter.splitSentences(CONTENT)

    expect(sentences.length).toBeGreaterThanOrEqual(5)
    expect(sentences[0].text).toBe('So I want to start with a story about a guy.')
    expect(sentences[0].startMs).toBe(0)
    for (let i = 0; i < sentences.length; i++) {
      expect(sentences[i].endMs).toBeGreaterThan(sentences[i].startMs)
      if (i > 0) {
        expect(sentences[i].startMs).toBe(sentences[i - 1].endMs)
      }
    }
  })

  test('generateQuiz 返回三种题型的题目', async () => {
    const quizzes: Quiz[] = await adapter.generateQuiz(CONTENT)

    expect(quizzes).toHaveLength(3)
    expect(new Set(quizzes.map((q) => q.type))).toEqual(
      new Set(['single-choice', 'fill-blank', 'true-false']),
    )

    const single = quizzes.find((q) => q.type === 'single-choice')
    expect(single).toBeDefined()
    if (single?.type === 'single-choice') {
      expect(single.options.length).toBeGreaterThan(1)
      expect(single.options).toContain(single.answer)
      expect(single.explanation).toBeTruthy()
    }

    const fill = quizzes.find((q) => q.type === 'fill-blank')
    expect(fill).toBeDefined()
    if (fill?.type === 'fill-blank') {
      expect(fill.question).toContain('______')
      expect(fill.answer).toBeTruthy()
    }

    const tf = quizzes.find((q) => q.type === 'true-false')
    expect(tf).toBeDefined()
    if (tf?.type === 'true-false') {
      expect(typeof tf.answer).toBe('boolean')
    }
  })

  test('相同输入返回相同结果（确定性，可作测试夹具）', async () => {
    expect(await adapter.extractWords(CONTENT)).toEqual(await adapter.extractWords(CONTENT))
    expect(await adapter.splitSentences(CONTENT)).toEqual(await adapter.splitSentences(CONTENT))
  })

  test('generateQuiz 轮换预设题库（新实例从第一套开始，循环取用）', async () => {
    const fresh = new MockTextAdapter(defaultTextConfig)
    const first = await fresh.generateQuiz(CONTENT)
    const second = await fresh.generateQuiz(CONTENT)
    const third = await fresh.generateQuiz(CONTENT)

    // 轮换出新题组，且两套题面不同
    expect(second).not.toEqual(first)
    expect(third).toEqual(first)
    expect(first[0].question).toBe('文章作者认为拖延的核心原因是什么？')
    expect(second[0].question).toBe('Panic Monster 在大脑里扮演什么角色？')
    // 两套均含三题型
    for (const set of [first, second]) {
      expect(new Set(set.map((q) => q.type))).toEqual(
        new Set(['single-choice', 'fill-blank', 'true-false']),
      )
    }
  })

  test('返回的是深拷贝，调用方修改不影响后续调用', async () => {
    const first = await adapter.extractWords(CONTENT)
    first[0].translation = '被污染'
    first.pop()

    const second = await adapter.extractWords(CONTENT)
    expect(second).toHaveLength(32)
    expect(second[0].translation).toBe('拖延症')
  })
})

describe('mock 声音适配器返回结构', () => {
  const adapter: VoiceAiAdapter = new MockVoiceAdapter(defaultVoiceConfig)

  test('synthesize 返回可播放的 wav data URI 与时长', async () => {
    const result = await adapter.synthesize('The quick brown fox jumps over the lazy dog.')

    expect(result.audioUrl).toMatch(/^data:audio\/wav;base64,/)
    expect(result.mimeType).toBe('audio/wav')
    expect(result.durationMs).toBeGreaterThan(0)
  })

  test('相同输入返回相同结果（确定性）', async () => {
    expect(await adapter.synthesize('Same input.')).toEqual(await adapter.synthesize('Same input.'))
  })

  test('synthesizeAll 逐句合成，时长随句长变化', async () => {
    const results = await adapter.synthesizeAll(['Short.', 'A somewhat longer sentence here.'])
    expect(results).toHaveLength(2)
    expect(results[1].durationMs).toBeGreaterThan(results[0].durationMs)
  })

  test('语速配置参与合成：2.0x 时长减半（配置确实传入并被使用）', async () => {
    const text = 'one two three four five six seven eight nine ten'
    const normal = new MockVoiceAdapter({ ...defaultVoiceConfig, speed: 1.0 })
    const fast = new MockVoiceAdapter({ ...defaultVoiceConfig, speed: 2.0 })

    const a = await normal.synthesize(text)
    const b = await fast.synthesize(text)
    expect(b.durationMs).toBe(Math.round(a.durationMs / 2))
  })
})

describe('工厂与配置传递', () => {
  beforeEach(() => localStorage.clear())

  test('未保存配置时使用默认配置构造适配器', () => {
    const adapter = getTextAdapter()
    expect(adapter).toBeInstanceOf(MockTextAdapter)
    expect((adapter as MockTextAdapter).config).toEqual(defaultTextConfig)
  })

  test('工厂从 localStorage 读取已保存的文字模型配置并传给适配器', () => {
    const custom = {
      ...defaultTextConfig,
      apiKey: 'sk-test-123',
      baseUrl: 'https://example.com/v1',
      modelName: 'llama-3',
      temperature: 0.2,
    }
    saveTextConfig(custom)

    const adapter = getTextAdapter()
    expect((adapter as MockTextAdapter).config).toEqual(custom)
  })

  test('工厂从 localStorage 读取已保存的声音模型配置并传给适配器', () => {
    const custom: VoiceModelConfig = {
      ...defaultVoiceConfig,
      apiKey: 'sk-voice-456',
      voiceType: 'nova',
      speed: 1.5,
    }
    saveVoiceConfig(custom)

    const adapter = getVoiceAdapter()
    expect(adapter).toBeInstanceOf(MockVoiceAdapter)
    expect((adapter as MockVoiceAdapter).config).toEqual(custom)
  })

  test('调用方只依赖接口类型（接缝验证）', () => {
    const text: TextAiAdapter = getTextAdapter()
    const voice: VoiceAiAdapter = getVoiceAdapter()
    expect(text).toBeDefined()
    expect(voice).toBeDefined()
  })
})
