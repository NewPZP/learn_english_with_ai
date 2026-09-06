/**
 * 路由路径常量 — 全应用唯一来源，避免字符串散落
 */
export const routes = {
  articles: '/articles',
  articleImport: '/articles/import',
  articleWords: (id: string | number) => `/articles/${id}/words`,
  articleDeepLearning: (id: string | number) => `/articles/${id}/podcast`,
  articleProcess: (id: string | number) => `/articles/${id}/process`,
  aiConfig: '/ai-config',
  discover: '/discover',
  discoverChannel: (channelId: string) => `/discover/${channelId}`,
  vocabWords: '/vocabulary/words',
  vocabPhrases: '/vocabulary/phrases',
  vocabReview: (kind: 'words' | 'phrases') => `/vocabulary/${kind}/review`,
  settings: '/settings',
} as const
