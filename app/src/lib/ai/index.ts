/**
 * AI 服务适配器层入口（统一工厂）
 * 调用方通过 getTextAdapter()/getVoiceAdapter() 获取适配器，
 * 只依赖接口类型，不感知 mock / 真实供应商的差异。
 * 接入真实 LLM/TTS 供应商时只改本文件的构造逻辑，调用方零改动。
 */
import { loadAiConfig, type TextModelConfig, type VoiceModelConfig } from '../aiConfig'
import { MockTextAdapter, MockVoiceAdapter } from './mockAdapters'
import type { TextAiAdapter, VoiceAiAdapter } from './types'

export function getTextAdapter(config: TextModelConfig = loadAiConfig().text): TextAiAdapter {
  return new MockTextAdapter(config)
}

export function getVoiceAdapter(config: VoiceModelConfig = loadAiConfig().voice): VoiceAiAdapter {
  return new MockVoiceAdapter(config)
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
