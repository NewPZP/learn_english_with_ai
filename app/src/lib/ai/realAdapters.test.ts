import { describe, test, expect, vi } from 'vitest'
import { defaultTextConfig, defaultVoiceConfig, type VoiceModelConfig } from '../aiConfig'
import {
  OpenAiTextAdapter,
  OpenAiVoiceAdapter,
  VolcanoVoiceAdapter,
  parseJsonLoose,
  speedToSpeechRate,
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

  test('输出被 max_tokens 截断（finish_reason=length）时报明确错误', async () => {
    const truncated = { choices: [{ finish_reason: 'length', message: { content: '[{"word":"con' } }] }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => truncated,
      text: async () => '',
    })
    const adapter = new OpenAiTextAdapter(textConfig(), { fetch: fetchMock as unknown as FetchLike })

    await expect(adapter.extractWords(CONTENT)).rejects.toThrow('Max Tokens 截断')
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

describe('火山豆包 TTS 适配器', () => {
  /** 火山真实响应：JSON 包裹 base64 音频 {"code":0,"message":"","data":"<base64>"} */
  function volcanoJsonResponse(base64Audio?: string): Response {
    // 用一个伪 mp3 二进制（ID3 头 + 几个字节）做 base64，验证解码链路
    const fakeAudio = base64Audio ?? btoa(String.fromCharCode(0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00))
    return {
      ok: true,
      status: 200,
      // 火山实际返回 text/plain，body 为 JSON
      headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
      text: async () => JSON.stringify({ code: 0, message: '', data: fakeAudio }),
      blob: async () => new Blob(),
    } as unknown as Response
  }

  /** 非 JSON 二进制响应（fallback 场景，content-type 为 audio） */
  function volcanoBinaryResponse(): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
      blob: async () => new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/mpeg' }),
      text: async () => '',
    } as unknown as Response
  }

  function volcanoAdapter(
    fetchMock: ReturnType<typeof vi.fn>,
    probedMs = 8888,
    overrides: Partial<VoiceModelConfig> = {},
  ) {
    return new VolcanoVoiceAdapter(
      {
        ...defaultVoiceConfig,
        protocol: 'volcano',
        apiKey: 'volcano-key',
        baseUrl: 'https://openspeech.bytedance.com/',
        modelName: 'seed-tts-2.0-standard',
        voiceType: 'zh_female_cancan_mars_bigtts',
        audioFormat: 'mp3',
        speed: 1.2,
        ...overrides,
      },
      { fetch: fetchMock as unknown as FetchLike, probeDurationMs: async () => probedMs },
    )
  }

  test('speedToSpeechRate 映射：0.5x→-50 / 1x→0 / 2x→100 / 1.35x→35', () => {
    expect(speedToSpeechRate(0.5)).toBe(-50)
    expect(speedToSpeechRate(1)).toBe(0)
    expect(speedToSpeechRate(2)).toBe(100)
    expect(speedToSpeechRate(1.35)).toBe(35)
  })

  test('synthesize 请求 unidirectional 端点，携带火山鉴权头与嵌套请求体', async () => {
    const fetchMock = vi.fn().mockResolvedValue(volcanoJsonResponse())
    const adapter = volcanoAdapter(fetchMock)

    const result = await adapter.synthesize('Hello volcano.')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      expect.objectContaining({ method: 'POST' }),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Api-Key']).toBe('volcano-key')
    expect(headers['X-Api-Resource-Id']).toBe('seed-tts-2.0')
    expect(headers['X-Api-Request-Id']).toBeTruthy()

    const body = JSON.parse(String(init.body))
    expect(body.user).toEqual({ uid: 'linguaai' })
    expect(body.req_params).toMatchObject({
      text: 'Hello volcano.',
      speaker: 'zh_female_cancan_mars_bigtts',
    })
    // 普通音色不传 model 字段（用服务端默认值）
    expect(body.req_params.model).toBeUndefined()
    expect(body.req_params.audio_params).toEqual({
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 20, // 1.2x → (1.2-1)*100
    })

    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/)
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.durationMs).toBe(8888)
  })

  test('ICL 复刻音色：X-Api-Resource-Id=seed-icl-2.0 且请求体携带 model 字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(volcanoJsonResponse())
    const adapter = volcanoAdapter(fetchMock, 0, {
      voiceType: 'ICL_uranus_en_male_kevin_mccallister_tob',
      modelName: 'seed-tts-2.0-standard',
    })

    await adapter.synthesize('Hello.')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Api-Resource-Id']).toBe('seed-icl-2.0')

    const body = JSON.parse(String(init.body))
    expect(body.req_params.speaker).toBe('ICL_uranus_en_male_kevin_mccallister_tob')
    // model 字段固定为模型版本 seed-icl-2.0，不使用用户配置的 modelName
    expect(body.req_params.model).toBe('seed-icl-2.0')
  })

  test('ogg_opus 格式使用 48000 采样率（火山限制）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(volcanoJsonResponse())
    const adapter = volcanoAdapter(fetchMock, 0, { audioFormat: 'opus' })

    await adapter.synthesize('Hello.')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.req_params.audio_params.format).toBe('ogg_opus')
    expect(body.req_params.audio_params.sample_rate).toBe(48000)
  })

  test('音频格式映射：opus → ogg_opus（audio/ogg），aac 回落 mp3', async () => {
    const opusMock = vi.fn().mockResolvedValue(volcanoJsonResponse())
    await volcanoAdapter(opusMock, 0, { audioFormat: 'opus' }).synthesize('Opus case.')
    const opusBody = JSON.parse(String((opusMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(opusBody.req_params.audio_params.format).toBe('ogg_opus')

    const aacMock = vi.fn().mockResolvedValue(volcanoJsonResponse())
    await volcanoAdapter(aacMock, 0, { audioFormat: 'aac' }).synthesize('Aac case.')
    const aacBody = JSON.parse(String((aacMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(aacBody.req_params.audio_params.format).toBe('mp3')
  })

  test('超长文本按 500 字符上限分块请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(volcanoJsonResponse())
    const adapter = volcanoAdapter(fetchMock, 0)

    const longText = 'This is a sentence for volcano chunk tests. '.repeat(15) // ~750 字符
    await adapter.synthesize(longText)

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of fetchMock.mock.calls as unknown[] as [string, RequestInit][]) {
      const body = JSON.parse(String(call[1].body))
      expect(body.req_params.text.length).toBeLessThanOrEqual(500)
    }
  })

  test('200 + JSON 错误响应（code != 0）抛出服务端错误信息', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
      text: async () => JSON.stringify({ code: 1001, message: 'invalid speaker' }),
    })
    const adapter = volcanoAdapter(fetchMock)

    await expect(adapter.synthesize('Hello.')).rejects.toThrow('语音合成失败：invalid speaker')
  })

  test('200 + JSON 成功响应（code:0 + data base64）解码为可播放音频', async () => {
    const fakeBase64 = btoa(String.fromCharCode(0x49, 0x44, 0x33, 0x04))
    const fetchMock = vi.fn().mockResolvedValue(volcanoJsonResponse(fakeBase64))
    const adapter = volcanoAdapter(fetchMock)

    const result = await adapter.synthesize('Hello volcano.')

    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/)
    // 解码后的 data URI base64 部分应还原为原始音频字节（ID3 头）
    const base64Part = result.audioUrl.split(',')[1]
    const decoded = atob(base64Part)
    expect(decoded.charCodeAt(0)).toBe(0x49) // 'I'
    expect(decoded.charCodeAt(1)).toBe(0x44) // 'D'
    expect(decoded.charCodeAt(2)).toBe(0x33) // '3'
  })

  test('多个 JSON chunk 拼接（火山流式响应）：提取所有 data 并拼接解码', async () => {
    // 模拟火山流式返回：两个 JSON chunk 直接拼接
    const chunk1 = btoa(String.fromCharCode(0x49, 0x44, 0x33)) // 'ID3'
    const chunk2 = btoa(String.fromCharCode(0x04, 0x00, 0x00))
    const multiChunk = `{"code":0,"message":"","data":"${chunk1}"}{"code":0,"data":"${chunk2}"}`
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
      text: async () => multiChunk,
      blob: async () => new Blob(),
    } as unknown as Response)
    const adapter = volcanoAdapter(fetchMock)

    const result = await adapter.synthesize('Hello.')

    const base64Part = result.audioUrl.split(',')[1]
    const decoded = atob(base64Part)
    // 拼接后应为 ID3 + 后续字节
    expect(decoded.charCodeAt(0)).toBe(0x49)
    expect(decoded.charCodeAt(1)).toBe(0x44)
    expect(decoded.charCodeAt(2)).toBe(0x33)
    expect(decoded.charCodeAt(3)).toBe(0x04)
  })

  test('非 JSON 二进制响应（audio content-type）直接取 blob（fallback）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(volcanoBinaryResponse())
    const adapter = volcanoAdapter(fetchMock, 0)

    const result = await adapter.synthesize('Hello.')
    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/)
  })

  test('HTTP 失败时抛错并带状态码', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    })
    const adapter = volcanoAdapter(fetchMock)

    await expect(adapter.synthesize('Hello.')).rejects.toThrow('语音合成失败（HTTP 403）')
  })

  test('音色 ID 未填写时抛错（引导用户回配置页填写）', async () => {
    const adapter = volcanoAdapter(vi.fn(), 0, { voiceType: '' })
    await expect(adapter.synthesize('Hello.')).rejects.toThrow('音色 ID')
  })

  test('synthesizeAll 串行执行（火山并发限制，任意时刻仅一个在途请求）', async () => {
    let active = 0
    let maxActive = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active--
      return volcanoJsonResponse()
    })
    const adapter = volcanoAdapter(fetchMock, 100)

    const results = await adapter.synthesizeAll(['A.', 'B.', 'C.'])

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.durationMs === 100)).toBe(true)
    expect(maxActive).toBe(1)
  })
})
