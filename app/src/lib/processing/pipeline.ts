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

/**
 * 将句级时间轴等比缩放到实际语音时长。
 * 文本分句给出的时间轴是估算值，TTS 返回的 durationMs 才是真实音源时长；
 * 等比缩放保证字幕高亮、进度条与句级跳听都在真实时长范围内。
 */
export function fitSentencesToDuration(sentences: Sentence[], durationMs: number): Sentence[] {
  if (sentences.length === 0 || durationMs <= 0) return sentences
  const lastEnd = sentences[sentences.length - 1].endMs
  if (lastEnd <= 0) return sentences
  const scale = durationMs / lastEnd
  if (Math.abs(scale - 1) < 1e-9) return sentences
  return sentences.map((sentence) => ({
    ...sentence,
    startMs: Math.round(sentence.startMs * scale),
    endMs: Math.round(sentence.endMs * scale),
  }))
}

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

/** 按 step 生成完成摘要文案；execStep 与加工页初始状态推导共用，避免文案双写 */
export function summarizeStep(step: StepId, state: PipelineState): string {
  if (step === 'words') return `已提取 ${state.words.length} 个单词`
  if (step === 'phrases') return `已提取 ${state.phrases.length} 个短语`
  const seconds = Math.round((state.audio?.durationMs ?? 0) / 1000)
  return `语音已生成（约 ${seconds} 秒）`
}

/**
 * 执行单个 step 的适配器调用并把产物写回 state：
 * words → extractWords；phrases → extractPhrases；audio → splitSentences + synthesize（并等比缩放时间轴）。
 * 成功置 done + summary，失败置 error（不抛出，由调用方决定后续）。
 */
async function execStep(
  state: PipelineState,
  step: StepId,
  content: string,
  adapters: PipelineAdapters,
): Promise<void> {
  if (step === 'words') {
    state.words = await adapters.text.extractWords(content)
  } else if (step === 'phrases') {
    state.phrases = await adapters.text.extractPhrases(content)
  } else {
    // 语音步骤同时产出句级分句（时间轴供播客字幕/逐句精听消费），
    // 并将估算时间轴等比缩放到 TTS 真实时长
    state.sentences = await adapters.text.splitSentences(content)
    state.audio = await adapters.voice.synthesize(content)
    state.sentences = fitSentencesToDuration(state.sentences, state.audio.durationMs)
  }
  state.steps[step] = { status: 'done', summary: summarizeStep(step, state) }
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
      await execStep(state, step, content, adapters)
      notify()
    } catch (err) {
      state.steps[step] = { status: 'error', error: errorMessage(err) }
      notify()
      return { ...state, steps: { ...state.steps }, completed: false }
    }
  }

  return { ...state, steps: { ...state.steps }, completed: true }
}

/**
 * 单步执行：只跑指定 step，其余 step 状态保持不变。
 * 用于「AI 预处理」加工页的独立操作——用户可单独提取单词/短语/音频，
 * 互不依赖、可重复执行（重提取覆盖旧产物，不影响其它已完成的产物）。
 * completed 仅反映目标 step 是否成功，与其它 step 状态无关。
 */
export async function runPipelineStep(
  content: string,
  adapters: PipelineAdapters,
  step: StepId,
  options: RunPipelineOptions = {},
): Promise<PipelineResult> {
  const state: PipelineState = options.initialState
    ? {
        ...options.initialState,
        steps: { ...options.initialState.steps },
        words: [...options.initialState.words],
        phrases: [...options.initialState.phrases],
        sentences: [...options.initialState.sentences],
        audio: options.initialState.audio ? { ...options.initialState.audio } : null,
      }
    : initialPipelineState()
  const notify = () => options.onStateChange?.({ ...state, steps: { ...state.steps } })

  state.steps[step] = { status: 'running' }
  notify()

  try {
    await execStep(state, step, content, adapters)
    notify()
    return { ...state, steps: { ...state.steps }, completed: true }
  } catch (err) {
    state.steps[step] = { status: 'error', error: errorMessage(err) }
    notify()
    return { ...state, steps: { ...state.steps }, completed: false }
  }
}
