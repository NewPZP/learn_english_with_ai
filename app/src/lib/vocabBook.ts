/**
 * 生词本领域模型：跨文章的生词/短语收录索引（与文章内进度解耦）
 * - 单词与短语分表存储（linguaai.vocab_words / linguaai.vocab_phrases）
 * - 同一词来自多篇文章时合并为一条，sourceArticleIds 保留全部来源
 * - 掌握程度仍由 wordProgress 的 WordProgressRecord 承载，本模块只做收录关系与聚合
 */
import type { WordProgressRecord } from './wordProgress'
import { loadWordProgress, loadPhraseProgress } from './wordProgress'

export interface VocabEntry {
  /** 词面（单词或短语） */
  text: string
  /** 音标（单词有，短语为空字符串） */
  phonetic: string
  /** 中文释义 */
  translation: string
  /** 词性（单词有，短语无） */
  partOfSpeech?: string
  /** 来源文章 id 列表 */
  sourceArticleIds: string[]
  /** 收录时间 ISO */
  collectedAt: string
}

const WORD_STORAGE_KEY = 'linguaai.vocab_words'
const PHRASE_STORAGE_KEY = 'linguaai.vocab_phrases'

type VocabStore = Record<string, VocabEntry>

function loadStore(storageKey: string): VocabStore {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as VocabStore) : {}
  } catch {
    return {}
  }
}

function persistStore(storageKey: string, store: VocabStore): void {
  localStorage.setItem(storageKey, JSON.stringify(store))
}

/* ---- 通用收录操作 ---- */

interface AddEntryInput {
  text: string
  phonetic?: string
  translation?: string
  partOfSpeech?: string
  articleId: string
  now?: Date
}

function addEntry(storageKey: string, input: AddEntryInput): VocabEntry {
  const store = loadStore(storageKey)
  const existing = store[input.text]
  const now = (input.now ?? new Date()).toISOString()
  const sourceArticleIds = existing
    ? existing.sourceArticleIds.includes(input.articleId)
      ? existing.sourceArticleIds
      : [...existing.sourceArticleIds, input.articleId]
    : [input.articleId]
  const entry: VocabEntry = {
    text: input.text,
    phonetic: input.phonetic ?? existing?.phonetic ?? '',
    translation: input.translation ?? existing?.translation ?? '',
    partOfSpeech: input.partOfSpeech ?? existing?.partOfSpeech,
    sourceArticleIds,
    collectedAt: existing?.collectedAt ?? now,
  }
  store[input.text] = entry
  persistStore(storageKey, store)
  return entry
}

function removeEntry(storageKey: string, text: string): void {
  const store = loadStore(storageKey)
  if (store[text]) {
    delete store[text]
    persistStore(storageKey, store)
  }
}

function listEntries(storageKey: string): VocabEntry[] {
  const store = loadStore(storageKey)
  return Object.values(store)
}

function isCollected(storageKey: string, text: string): boolean {
  return loadStore(storageKey)[text] !== undefined
}

/* ---- 单词 ---- */

export function addWordEntry(input: AddEntryInput): VocabEntry {
  return addEntry(WORD_STORAGE_KEY, input)
}

export function removeWordEntry(text: string): void {
  removeEntry(WORD_STORAGE_KEY, text)
}

export function listWordEntries(): VocabEntry[] {
  return listEntries(WORD_STORAGE_KEY)
}

export function isWordCollected(text: string): boolean {
  return isCollected(WORD_STORAGE_KEY, text)
}

/* ---- 短语 ---- */

export function addPhraseEntry(input: AddEntryInput): VocabEntry {
  return addEntry(PHRASE_STORAGE_KEY, input)
}

export function removePhraseEntry(text: string): void {
  removeEntry(PHRASE_STORAGE_KEY, text)
}

export function listPhraseEntries(): VocabEntry[] {
  return listEntries(PHRASE_STORAGE_KEY)
}

export function isPhraseCollected(text: string): boolean {
  return isCollected(PHRASE_STORAGE_KEY, text)
}

/* ---- 多源掌握程度聚合 ---- */

/**
 * 从某词的所有来源文章进度记录中取最新自评作为全局掌握状态
 * 若所有来源都无记录则返回 undefined（未评）
 */
export function aggregateLatestWordRecord(text: string): WordProgressRecord | undefined {
  const store = loadStore(WORD_STORAGE_KEY)
  const entry = store[text]
  return aggregateLatest(entry, loadWordProgress)
}

export function aggregateLatestPhraseRecord(text: string): WordProgressRecord | undefined {
  const store = loadStore(PHRASE_STORAGE_KEY)
  const entry = store[text]
  return aggregateLatest(entry, loadPhraseProgress)
}

function aggregateLatest(
  entry: VocabEntry | undefined,
  loadProgress: (articleId: string) => Record<string, WordProgressRecord>,
): WordProgressRecord | undefined {
  if (!entry) return undefined
  let latest: WordProgressRecord | undefined
  for (const articleId of entry.sourceArticleIds) {
    const record = loadProgress(articleId)[entry.text]
    if (!record) continue
    if (!latest || new Date(record.ratedAt).getTime() > new Date(latest.ratedAt).getTime()) {
      latest = record
    }
  }
  return latest
}

/** 获取某收录条目的全部来源文章进度记录（用于展示来源列表或复习调度） */
export function getWordSourceRecords(text: string): WordProgressRecord[] {
  return getSourceRecords(WORD_STORAGE_KEY, text, loadWordProgress)
}

export function getPhraseSourceRecords(text: string): WordProgressRecord[] {
  return getSourceRecords(PHRASE_STORAGE_KEY, text, loadPhraseProgress)
}

function getSourceRecords(
  storageKey: string,
  text: string,
  loadProgress: (articleId: string) => Record<string, WordProgressRecord>,
): WordProgressRecord[] {
  const entry = loadStore(storageKey)[text]
  if (!entry) return []
  return entry.sourceArticleIds
    .map((articleId) => loadProgress(articleId)[text])
    .filter((r): r is WordProgressRecord => r !== undefined)
}
