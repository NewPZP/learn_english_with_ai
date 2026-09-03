/**
 * 导入 AI 处理管道（PRD 接缝二的编排层）
 * 三步依次流转：提取关键词汇 → 提取重点短语 → 生成语音文件
 * 通过适配器接口调用（mock / 真实供应商零差异），编排逻辑不感知供应商。
 * runPipeline 可从首个未完成步骤续跑：单步失败后再次调用即为「重试该步并继续」。
 */
import type { PhraseEntry, Sentence, TextAiAdapter, TtsResult, VoiceAiAdapter, WordEntry } from '../ai/types'

/** 管道步骤标识（顺序即执行顺序） */
export type StepId = 'words' | 'phrases' | 'audio'

/** 步骤状态：待处理 / 进行中 / 完成 / 失败 */
export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export interface PipelineStepState {
  status: StepStatus
  /** 完成后的结果摘要，如「已提取 32 个单词」 */
  summary?: string
  /** 失败原因（status === 'error' 时存在） */
  error?: string
}

/** 管道整体状态：三步状态 + 已产出的数据 */
export interface PipelineState {
  steps: Record<StepId, PipelineStepState>
  words: WordEntry[]
  phrases: PhraseEntry[]
  sentences: Sentence[]
  audio: TtsResult | null
}

export interface PipelineResult extends PipelineState {
  /** 三步是否全部完成 */
  completed: boolean
}

/** 管道依赖的适配器集合（测试接缝：可注入任意实现） */
export interface PipelineAdapters {
  text: TextAiAdapter
  voice: VoiceAiAdapter
}

export const STEP_ORDER: readonly StepId[] = ['words', 'phrases', 'audio'] as const

export const STEP_TITLES: Record<StepId, string> = {
  words: '提取关键词汇',
  phrases: '提取重点短语',
  audio: '生成语音文件',
}

export function initialPipelineState(): PipelineState {
  return {
    steps: {
      words: { status: 'pending' },
      phrases: { status: 'pending' },
      audio: { status: 'pending' },
    },
    words: [],
    phrases: [],
    sentences: [],
    audio: null,
  }
}

export interface RunPipelineOptions {
  /** 续跑起点：传入上次的状态（已完成步骤跳过）；缺省从头开始 */
  initialState?: PipelineState
  /** 每次状态变化时回调（驱动 UI 实时刷新） */
  onStateChange?: (state: PipelineState) => void
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 执行（或续跑）处理管道：
 * ① extractWords → ② extractPhrases → ③ splitSentences + synthesize
 * 任一步失败即停：该步置 error，后续步骤保持 pending，返回 completed: false。
 * 再次调用并传入失败时的状态即可重试失败步骤并继续后续步骤。
 */
export async function runPipeline(
  content: string,
  adapters: PipelineAdapters,
  options: RunPipelineOptions = {},
): Promise<PipelineResult> {
  const state: PipelineState = options.initialState
    ? {
        ...options.initialState,
        steps: { ...options.initialState.steps },
        // 深拷贝产物数组，避免与传入状态共享引用
        words: [...options.initialState.words],
        phrases: [...options.initialState.phrases],
        sentences: [...options.initialState.sentences],
        audio: options.initialState.audio ? { ...options.initialState.audio } : null,
      }
    : initialPipelineState()
  const notify = () => options.onStateChange?.({ ...state, steps: { ...state.steps } })

  for (const step of STEP_ORDER) {
    if (state.steps[step].status === 'done') continue

    state.steps[step] = { status: 'running' }
    notify()

    try {
      if (step === 'words') {
        state.words = await adapters.text.extractWords(content)
        state.steps[step] = { status: 'done', summary: `已提取 ${state.words.length} 个单词` }
      } else if (step === 'phrases') {
        state.phrases = await adapters.text.extractPhrases(content)
        state.steps[step] = { status: 'done', summary: `已提取 ${state.phrases.length} 个短语` }
      } else {
        // 语音步骤同时产出句级分句（时间轴供播客字幕/逐句精听消费）
        state.sentences = await adapters.text.splitSentences(content)
        state.audio = await adapters.voice.synthesize(content)
        const seconds = Math.round(state.audio.durationMs / 1000)
        state.steps[step] = { status: 'done', summary: `语音已生成（约 ${seconds} 秒）` }
      }
      notify()
    } catch (err) {
      state.steps[step] = { status: 'error', error: errorMessage(err) }
      notify()
      return { ...state, steps: { ...state.steps }, completed: false }
    }
  }

  return { ...state, steps: { ...state.steps }, completed: true }
}
