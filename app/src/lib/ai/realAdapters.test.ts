import { describe, test, expect, vi } from 'vitest'
import { defaultTextConfig, defaultVoiceConfig } from '../aiConfig'
import {
  OpenAiTextAdapter,
  OpenAiVoiceAdapter,
  parseJsonLoose,
  splitForTts,
  type FetchLike,
} from './realAdapters'

/**
 * 真实适配器（OpenAI 兼容）验收测试
 * fetch 与时长探测全部注入，不发真实网络请求
 */

const CONTENT = 'The quick brown fox jumps over the lazy dog. Then it rests.'

/** 构造 chat/completions 假响应（可指定模型回复原文） */
function chatResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  } as unknown as Response
}

function speechResponse(): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
    text: async () => '',
  } as unknown as Response
}

function textConfig(overrides = {}) {
  return { ...defaultTextConfig, apiKey: 'sk-test', ...overrides }
}

describe('parseJsonLoose 宽松 JSON 解析', () => {
  test('直接 JSON 数组', () => {
    expect(parseJsonLoose<number[]>('[1,2,3]')).toEqual([1, 2, 3])
  })

  test('剥 ```json 代码围栏', () => {
    expect(parseJsonLoose<number[]>('```json\n[1,2]\n```')).toEqual([1, 2])
  })

  test('单键对象解包：{"words":[...]} → [...]', () => {
    expect(parseJsonLoose<number[]>('{"words":[1,2]}')).toEqual([1, 2])
  })

  test('截取前后杂文中的 JSON 片段', () => {
    expect(parseJsonLoose<number[]>('好的，结果如下：[4,5] 以上。')).toEqual([4, 5])
  })

  test('非法内容抛错', () => {
    expect(() => parseJsonLoose('抱歉，我无法处理')).toThrow('不是合法 JSON')
  })
})

describe('OpenAI 文字适配器', () => {
  test('extractWords 请求携带模型配置与鉴权头，返回归一化词条', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      chatResponse(
        JSON.stringify([
          {
            word: 'connectivity',
            phonetic: '/ˌkɒnekˈtɪvəti/',
            partOfSpeech: 'n.',
            definition: 'The state of being connected.',
            translation: '连通性',
            example: 'Constant connectivity causes stress.',
            synonyms: ['connection'],
          },
          { nope: '缺少 word 字段应被过滤' },
        ]),
      ),
    )
    const adapter = new OpenAiTextAdapter(
      textConfig({ baseUrl: 'https://api.example.com/v1/', modelName: 'gpt-4o-mini', temperature: 0.3 }),
      { fetch: fetchMock as unknown as FetchLike },
    )

    const words = await adapter.extractWords(CONTENT)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sk-test',
        },
      }),
    )

    expect(words).toEqual([
      {
        word: 'connectivity',
        phonetic: '/ˌkɒnekˈtɪvəti/',
        partOfSpeech: 'n.',
        definition: 'The state of being connected.',
        translation: '连通性',
        example: 'Constant connectivity causes stress.',
        synonyms: ['connection'],
      },
    ])
  })

  test('请求体包含 model / temperature / max_tokens 与提示词约束', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('[]'))
    const adapter = new OpenAiTextAdapter(
      textConfig({ modelName: 'llama-3', temperature: 0.2, maxTokens: 1024 }),
      { fetch: fetchMock as unknown as FetchLike },
    )

    await adapter.extractPhrases(CONTENT)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('llama-3')
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(1024)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1]).toEqual({ role: 'user', content: CONTENT })
  })

  test('splitSentences 返回单调连续时间轴并保留译文', async () => {
    const sentences = [
      { text: 'Short one.', translation: '短句。' },
      { text: 'A considerably longer second sentence right here.', translation: '长句。' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(
      chatResponse(`\`\`\`json\n${JSON.stringify(sentences)}\n\`\`\``),
    )
    const adapter = new OpenAiTextAdapter(textConfig(), { fetch: fetchMock as unknown as FetchLike })

    const result = await adapter.splitSentences(CONTENT)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ text: 'Short one.', translation: '短句。', startMs: 0 })
    expect(result[0].endMs).toBeGreaterThan(0)
    expect(result[1].startMs).toBe(result[0].endMs)
    // 时间轴按字符长度比例分配：长句跨度大于短句
    const span0 = result[0].endMs - result[0].startMs
    const span1 = result[1].endMs - result[1].startMs
    expect(span1).toBeGreaterThan(span0)
  })

  test('generateQuiz 校验题目结构：单选 answer 必须在 options 中，坏题被过滤', async () => {
    const quizzes = [
      {
        type: 'single-choice',
        question: '文章主旨是什么？',
        options: ['A', 'B', 'C'],
        answer: 'A',
        explanation: '解析',
      },
      {
        type: 'single-choice',
        question: '坏题：answer 不在 options 中',
        options: ['A', 'B'],
        answer: 'X',
        explanation: '解析',
      },
      {
        type: 'fill-blank',
        question: '文中提到 ______ 导致焦虑。',
        answer: 'connectivity',
        explanation: '解析',
      },
      { type: 'true-false', question: '狐狸最终休息了。', answer: true, explanation: '解析' },
      { type: 'unknown-type', question: '?', answer: '?', explanation: '?' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(
      chatResponse(JSON.stringify({ quizzes })),
    )
    const adapter = new OpenAiTextAdapter(textConfig(), { fetch: fetchMock as unknown as FetchLike })

    const result = await adapter.generateQuiz(CONTENT)

    expect(result).toHaveLength(3)
    expect(result.map((q) => q.type)).toEqual(['single-choice', 'fill-blank', 'true-false'])
  })

  test('空内容抛错（与 mock 行为一致）', async () => {
    const adapter = new OpenAiTextAdapter(textConfig(), {
      fetch: vi.fn() as unknown as FetchLike,
    })
    await expect(adapter.extractWords('  ')).rejects.toThrow('文章内容不能为空')
    await expect(adapter.splitSentences('')).rejects.toThrow('文章内容不能为空')
  })

  test('HTTP 失败时抛错并带状态码', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })
    const adapter = new OpenAiTextAdapter(textConfig(), { fetch: fetchMock as unknown as FetchLike })

    await expect(adapter.extractWords(CONTENT)).rejects.toThrow('HTTP 429')
  })

  test('模型未返回内容时抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(''))
    const adapter = new OpenAiTextAdapter(textConfig(), { fetch: fetchMock as unknown as FetchLike })

    await expect(adapter.extractWords(CONTENT)).rejects.toThrow('模型未返回内容')
  })
})

describe('splitForTts 超长分块', () => {
  test('短文本单块返回', () => {
    expect(splitForTts('Hello world.', 4000)).toEqual(['Hello world.'])
  })

  test('按句边界分块且每块不超上限', () => {
    const sentence = 'This is a numbered sentence for chunking. '
    const longText = sentence.repeat(100) // ~4100 字符
    const chunks = splitForTts(longText, 4000)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000)
      expect(chunk).toMatch(/chunking\.$/)
    }
    // 分块无损：拼接后内容一致（空白归一）
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(
      longText.replace(/\s+/g, ' ').trim(),
    )
  })

  test('单句超限时按空格硬切', () => {
    const noPunctuation = 'word '.repeat(1200) // 单句无标点，~6000 字符
    const chunks = splitForTts(noPunctuation, 4000)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000)
    }
  })
})

describe('OpenAI 声音适配器', () => {
  function voiceAdapter(fetchMock: ReturnType<typeof vi.fn>, probedMs = 12_345) {
    return new OpenAiVoiceAdapter(
      { ...defaultVoiceConfig, apiKey: 'vk-test', voiceType: 'nova', speed: 1.5 },
      { fetch: fetchMock as unknown as FetchLike, probeDurationMs: async () => probedMs },
    )
  }

  test('synthesize 请求 /audio/speech 并携带全部语音配置', async () => {
    const fetchMock = vi.fn().mockResolvedValue(speechResponse())
    const adapter = voiceAdapter(fetchMock)

    const result = await adapter.synthesize('The quick brown fox jumps.')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({ method: 'POST' }),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      model: 'tts-1',
      voice: 'nova',
      speed: 1.5,
      response_format: 'mp3',
    })
    expect(body.input).toBe('The quick brown fox jumps.')

    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/)
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.durationMs).toBe(12_345)
  })

  test('超长文本分块请求后拼接（多次 /audio/speech）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(speechResponse())
    const adapter = voiceAdapter(fetchMock, 0) // 探测失败 → 走估算兜底

    const longText = 'This is a sentence for chunk tests. '.repeat(140) // ~8600 字符
    const result = await adapter.synthesize(longText)

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of fetchMock.mock.calls as unknown[] as [string, RequestInit][]) {
      const body = JSON.parse(String(call[1].body))
      expect(body.input.length).toBeLessThanOrEqual(4000)
    }
    // 探测失败 → 词数估算兜底（>0）
    expect(result.durationMs).toBeGreaterThan(0)
  })

  test('HTTP 失败时抛错并带状态码', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    })
    const adapter = voiceAdapter(fetchMock)

    await expect(adapter.synthesize('Hello.')).rejects.toThrow('语音合成失败（HTTP 401）')
  })

  test('空文本抛错（与 mock 行为一致）', async () => {
    const adapter = voiceAdapter(vi.fn())
    await expect(adapter.synthesize('   ')).rejects.toThrow('待合成文本不能为空')
  })

  test('synthesizeAll 逐条合成，顺序与输入一致', async () => {
    const fetchMock = vi.fn().mockResolvedValue(speechResponse())
    const adapter = voiceAdapter(fetchMock, 1000)

    const results = await adapter.synthesizeAll(['First.', 'Second.'])

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.durationMs === 1000)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
