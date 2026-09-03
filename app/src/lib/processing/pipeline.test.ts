import { describe, test, expect, vi } from 'vitest'
import { defaultTextConfig, defaultVoiceConfig } from '../aiConfig'
import { MockTextAdapter, MockVoiceAdapter } from '../ai/mockAdapters'
import type {
  PhraseEntry,
  Sentence,
  TtsResult,
  WordEntry,
} from '../ai/types'
import {
  initialPipelineState,
  runPipeline,
  STEP_ORDER,
  STEP_TITLES,
  type PipelineAdapters,
  type PipelineState,
} from './pipeline'

/**
 * 工单「导入 AI 处理管道」验收测试 — 管道编排
 * 覆盖：三步状态流转（待处理/进行中/完成）、失败重试、适配器参数传递、顺序执行
 */

const CONTENT =
  'Inside the Mind of a Master Procrastinator. So I want to start with a story about a guy.'

const DEFAULT_WORD: WordEntry = {
  word: 'w',
  phonetic: '/w/',
  partOfSpeech: 'n.',
  definition: 'd',
  translation: '译',
  example: 'e',
  synonyms: [],
}

const DEFAULT_PHRASE: PhraseEntry = { phrase: 'p', definition: 'd', translation: '译', example: 'e' }
const DEFAULT_SENTENCES: Sentence[] = [{ text: 's', startMs: 0, endMs: 1000 }]
const DEFAULT_TTS: TtsResult = {
  audioUrl: 'data:audio/wav;base64,x',
  mimeType: 'audio/wav',
  durationMs: 1500,
}

/** 记录调用顺序的假适配器基线（接口接缝：管道只依赖适配器接口） */
function makeBaselineAdapters(): PipelineAdapters & {
  calls: { method: string; arg: string }[]
} {
  const calls: { method: string; arg: string }[] = []
  const record = <T>(method: string, work: (arg: string) => Promise<T>) => {
    return async (arg: string) => {
      calls.push({ method, arg })
      return work(arg)
    }
  }
  return {
    calls,
    text: {
      extractWords: record('extractWords', async () => [DEFAULT_WORD]),
      extractPhrases: record('extractPhrases', async () => [DEFAULT_PHRASE]),
      splitSentences: record('splitSentences', async () => DEFAULT_SENTENCES),
      generateQuiz: async () => [],
    },
    voice: {
      synthesize: record('synthesize', async () => DEFAULT_TTS),
      synthesizeAll: async () => [],
    },
  }
}

describe('常量与初始状态', () => {
  test('步骤顺序与标题固定为三步', () => {
    expect(STEP_ORDER).toEqual(['words', 'phrases', 'audio'])
    expect(STEP_TITLES.words).toBe('提取关键词汇')
    expect(STEP_TITLES.phrases).toBe('提取重点短语')
    expect(STEP_TITLES.audio).toBe('生成语音文件')
  })

  test('初始状态：三步均待处理，无产物', () => {
    const state = initialPipelineState()
    expect(state.steps.words.status).toBe('pending')
    expect(state.steps.phrases.status).toBe('pending')
    expect(state.steps.audio.status).toBe('pending')
    expect(state.words).toEqual([])
    expect(state.phrases).toEqual([])
    expect(state.sentences).toEqual([])
    expect(state.audio).toBeNull()
  })
})

describe('三步依次流转', () => {
  test('全部成功：pending → running → done，结果计数正确', async () => {
    const adapters = makeBaselineAdapters()
    const result = await runPipeline(CONTENT, adapters)

    expect(result.completed).toBe(true)
    expect(result.steps.words).toEqual({ status: 'done', summary: '已提取 1 个单词' })
    expect(result.steps.phrases).toEqual({ status: 'done', summary: '已提取 1 个短语' })
    expect(result.steps.audio).toEqual({ status: 'done', summary: '语音已生成（约 2 秒）' })
    expect(result.words).toHaveLength(1)
    expect(result.phrases).toHaveLength(1)
    expect(result.sentences).toHaveLength(1)
    expect(result.audio?.durationMs).toBe(1500)
  })

  test('每步经历 running：onStateChange 发出 6 次快照（3 步 × running+done）', async () => {
    const adapters = makeBaselineAdapters()
    const states: PipelineState[] = []
    await runPipeline(CONTENT, adapters, { onStateChange: (s) => states.push(s) })

    expect(states).toHaveLength(6)
    // 依次观察到 words running → words done → phrases running → ...
    expect(states[0].steps.words.status).toBe('running')
    expect(states[1].steps.words.status).toBe('done')
    expect(states[2].steps.phrases.status).toBe('running')
    expect(states[2].steps.words.status).toBe('done') // 前序步骤保持完成
    expect(states[5].steps.audio.status).toBe('done')
  })

  test('后一步不会先于前一步开始（严格顺序）', async () => {
    const adapters = makeBaselineAdapters()
    await runPipeline(CONTENT, adapters)
    expect(adapters.calls.map((c) => c.method)).toEqual([
      'extractWords',
      'extractPhrases',
      'splitSentences',
      'synthesize',
    ])
  })
})

describe('单步失败与重试', () => {
  test('第二步失败：该步 error，第三步保持 pending，后续不再执行', async () => {
    const adapters = makeBaselineAdapters()
    adapters.text.extractPhrases = async () => {
      throw new Error('短语服务超时')
    }

    const result = await runPipeline(CONTENT, adapters)
    expect(result.completed).toBe(false)
    expect(result.steps.words.status).toBe('done')
    expect(result.steps.phrases).toEqual({ status: 'error', error: '短语服务超时' })
    expect(result.steps.audio.status).toBe('pending')
    // 失败后立即停止：语音相关方法未被调用
    expect(adapters.calls.map((c) => c.method)).not.toContain('synthesize')
  })

  test('重试：从失败步骤续跑，已完成步骤不重复调用', async () => {
    const adapters = makeBaselineAdapters()
    let phraseCalls = 0
    adapters.text.extractPhrases = async () => {
      phraseCalls += 1
      if (phraseCalls === 1) throw new Error('第一次失败')
      return [DEFAULT_PHRASE]
    }

    const failed = await runPipeline(CONTENT, adapters)
    expect(failed.completed).toBe(false)

    const retried = await runPipeline(CONTENT, adapters, { initialState: failed })
    expect(retried.completed).toBe(true)
    expect(retried.steps.phrases.status).toBe('done')
    // extractWords 只在首次运行调用过一次（重试未重复）
    expect(adapters.calls.filter((c) => c.method === 'extractWords')).toHaveLength(1)
    expect(phraseCalls).toBe(2)
  })

  test('非 Error 抛出物归一化为错误消息', async () => {
    const adapters = makeBaselineAdapters()
    adapters.text.extractWords = async () => {
      throw '字符串错误'
    }
    const result = await runPipeline(CONTENT, adapters)
    expect(result.steps.words).toEqual({ status: 'error', error: '字符串错误' })
  })

  test('语音步骤失败可单独重试，前两步不重复调用', async () => {
    const adapters = makeBaselineAdapters()
    let synthCalls = 0
    adapters.voice.synthesize = async () => {
      synthCalls += 1
      if (synthCalls === 1) throw new Error('TTS 限流')
      return { ...DEFAULT_TTS, durationMs: 2000 }
    }

    const failed = await runPipeline(CONTENT, adapters)
    expect(failed.steps.audio.status).toBe('error')

    const retried = await runPipeline(CONTENT, adapters, { initialState: failed })
    expect(retried.completed).toBe(true)
    expect(retried.steps.audio.summary).toBe('语音已生成（约 2 秒）')
    // 重试以步骤为原子单位：前两步各只调用一次，语音步骤整体重跑
    expect(adapters.calls.filter((c) => c.method === 'extractWords')).toHaveLength(1)
    expect(adapters.calls.filter((c) => c.method === 'extractPhrases')).toHaveLength(1)
    expect(adapters.calls.filter((c) => c.method === 'splitSentences')).toHaveLength(2)
    expect(synthCalls).toBe(2)
  })
})

describe('适配器参数传递与接缝', () => {
  test('全文内容原样传给各适配器方法', async () => {
    const adapters = makeBaselineAdapters()
    await runPipeline(CONTENT, adapters)
    for (const call of adapters.calls) {
      expect(call.arg).toBe(CONTENT)
    }
  })

  test('splitSentences 被调用且入参正确（vi.fn 验证）', async () => {
    const spy = vi.fn(async () => DEFAULT_SENTENCES)
    const adapters = makeBaselineAdapters()
    adapters.text.splitSentences = spy
    await runPipeline(CONTENT, adapters)
    expect(spy).toHaveBeenCalledWith(CONTENT)
  })

  test('通过真实 mock 适配器全链路跑通（接缝验证：调用方不感知供应商）', async () => {
    const adapters: PipelineAdapters = {
      text: new MockTextAdapter(defaultTextConfig),
      voice: new MockVoiceAdapter(defaultVoiceConfig),
    }
    const result = await runPipeline(CONTENT, adapters)

    expect(result.completed).toBe(true)
    expect(result.words).toHaveLength(32)
    expect(result.phrases).toHaveLength(8)
    expect(result.sentences.length).toBeGreaterThanOrEqual(5)
    expect(result.audio?.audioUrl).toMatch(/^data:audio\/wav;base64,/)
  })

  test('onStateChange 回调收到的状态是快照，修改不影响管道内部', async () => {
    const adapters = makeBaselineAdapters()
    const received: PipelineState[] = []
    await runPipeline(CONTENT, adapters, {
      onStateChange: (s) => {
        s.words = []
        received.push(s)
      },
    })
    // 最后一次快照被调用方清空，但再次运行管道产物不受影响
    expect(received.at(-1)?.words).toEqual([])
    const result = await runPipeline(CONTENT, adapters)
    expect(result.words).toHaveLength(1)
  })

  test('未传 onStateChange 时不抛错（仅返回最终结果）', async () => {
    const adapters = makeBaselineAdapters()
    await expect(runPipeline(CONTENT, adapters)).resolves.toMatchObject({ completed: true })
  })

  test('续跑不污染传入的初始状态', async () => {
    const adapters = makeBaselineAdapters()
    adapters.text.extractPhrases = async () => {
      throw new Error('fail')
    }
    const failed = await runPipeline(CONTENT, adapters)
    const snapshot: PipelineState = JSON.parse(JSON.stringify(failed))
    await runPipeline(CONTENT, adapters, { initialState: failed })
    expect(failed).toEqual(snapshot)
  })
})
