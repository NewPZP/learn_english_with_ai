/**
 * AI 服务适配器层入口（统一工厂）
 * 调用方通过 getTextAdapter()/getVoiceAdapter() 获取适配器，
 * 只依赖接口类型，不感知 mock / 真实供应商的差异。
 * 路由规则：数据来源模式为 real 且该模型已填 API Key → OpenAI 兼容真实适配器；
 * 否则（mock 模式或 real 模式缺 Key）→ Mock 适配器。
 */
import { loadAiConfig, type TextModelConfig, type VoiceModelConfig } from '../aiConfig'
import { MockTextAdapter, MockVoiceAdapter } from './mockAdapters'
import { OpenAiTextAdapter, OpenAiVoiceAdapter } from './realAdapters'
import type { TextAiAdapter, VoiceAiAdapter } from './types'

export function getTextAdapter(config?: TextModelConfig): TextAiAdapter {
  const { provider, text } = loadAiConfig()
  const effective = config ?? text
  return provider === 'real' && effective.apiKey.trim()
    ? new OpenAiTextAdapter(effective)
    : new MockTextAdapter(effective)
}

export function getVoiceAdapter(config?: VoiceModelConfig): VoiceAiAdapter {
  const { provider, voice } = loadAiConfig()
  const effective = config ?? voice
  return provider === 'real' && effective.apiKey.trim()
    ? new OpenAiVoiceAdapter(effective)
    : new MockVoiceAdapter(effective)
}

export type {
  FillBlankQuiz,
  PhraseEntry,
  Quiz,
  Sentence,
  SingleChoiceQuiz,
  TextAiAdapter,
  TtsResult,
  TrueFalseQuiz,
  VoiceAiAdapter,
  WordEntry,
} from './types'
