import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { ArticleListPage } from './pages/ArticleListPage'
import { ImportArticlePage } from './pages/ImportArticlePage'
import {
  WordPreviewPage,
  PodcastPage,
  IntensiveListeningPage,
  AiConfigPage,
} from './pages/studyPages'
import { routes } from './routes'

/**
 * 路由表（7 页面）：
 * /                      → 重定向到 /articles
 * /articles              → 文章列表
 * /articles/import       → 导入文章
 * /articles/:id/words    → 单词预习
 * /articles/:id/podcast  → 播客模式
 * /articles/:id/listening→ 听力训练
 * /ai-config             → AI 配置
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to={routes.articles} replace />} />
          <Route path={routes.articles} element={<ArticleListPage />} />
          <Route path={routes.articleImport} element={<ImportArticlePage />} />
          <Route path="/articles/:id/words" element={<WordPreviewPage />} />
          <Route path="/articles/:id/podcast" element={<PodcastPage />} />
          <Route path="/articles/:id/listening" element={<IntensiveListeningPage />} />
          <Route path={routes.aiConfig} element={<AiConfigPage />} />
          <Route path="*" element={<Navigate to={routes.articles} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
