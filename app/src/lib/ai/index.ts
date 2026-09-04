/**
 * AI 服务适配器层入口（统一工厂）
 * 调用方通过 getTextAdapter()/getVoiceAdapter() 获取适配器，
 * 只依赖接口类型，不感知 mock / 真实供应商的差异。
 * 路由规则：数据来源模式为 real 且该模型已填 API Key → 真实适配器
 * （声音模型按协议分流：openai → OpenAI 兼容，volcano → 火山豆包 TTS）；
 * 否则（mock 模式或 real 模式缺 Key）→ Mock 适配器。
 */
import { loadAiConfig, type TextModelConfig, type VoiceModelConfig } from '../aiConfig'
import { MockTextAdapter, MockVoiceAdapter } from './mockAdapters'
import { OpenAiTextAdapter, OpenAiVoiceAdapter, VolcanoVoiceAdapter } from './realAdapters'
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
  if (provider !== 'real' || !effective.apiKey.trim()) return new MockVoiceAdapter(effective)
  // 火山协议需同时校验音色 ID（voiceType 即控制台音色库 ID，缺失时回落 mock）
  if (effective.protocol === 'volcano') {
    return effective.voiceType.trim()
      ? new VolcanoVoiceAdapter(effective)
      : new MockVoiceAdapter(effective)
  }
  return new OpenAiVoiceAdapter(effective)
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
