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
          <Route path="/" element={<Navigate to="/articles" replace />} />
          <Route path="/articles" element={<ArticleListPage />} />
          <Route path="/articles/import" element={<ImportArticlePage />} />
          <Route path="/articles/:id/words" element={<WordPreviewPage />} />
          <Route path="/articles/:id/podcast" element={<PodcastPage />} />
          <Route path="/articles/:id/listening" element={<IntensiveListeningPage />} />
          <Route path="/ai-config" element={<AiConfigPage />} />
          <Route path="*" element={<Navigate to="/articles" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
