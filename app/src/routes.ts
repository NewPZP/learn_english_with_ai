/**
 * 路由路径常量 — 全应用唯一来源，避免字符串散落
 */
export const routes = {
  articles: '/articles',
  articleImport: '/articles/import',
  articleWords: (id: string | number) => `/articles/${id}/words`,
  articlePodcast: (id: string | number) => `/articles/${id}/podcast`,
  articleListening: (id: string | number) => `/articles/${id}/listening`,
  articleProcess: (id: string | number) => `/articles/${id}/process`,
  aiConfig: '/ai-config',
} as const
