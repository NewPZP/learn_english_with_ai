import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { ArticleListPage } from './pages/ArticleListPage'
import { ImportArticlePage } from './pages/ImportArticlePage'
import { WordPreviewPage } from './pages/WordPreviewPage'
import { PodcastPage } from './pages/PodcastPage'
import { AiConfigPage } from './pages/AiConfigPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { ChannelPage } from './pages/ChannelPage'
import { VocabBookPage } from './pages/VocabBookPage'
import { VocabReviewPage } from './pages/VocabReviewPage'
import { LearningSettingsPage } from './pages/LearningSettingsPage'
import { routes } from './routes'

/**
 * 路由表：
 * /                          → 重定向到 /articles
 * /articles                  → 文章列表
 * /articles/import           → 导入文章
 * /articles/:id/words        → 词汇预习
 * /articles/:id/podcast      → 深入学习（播客 + 挖空听写 + 听力挑战）
 * /articles/:id/process      → AI 预处理（加工页，复用导入页双模式）
 * /ai-config                 → AI 配置
 * /discover                  → 发现页（频道广场）
 * /discover/:channelId       → 频道详情
 * /vocabulary/words          → 生词本
 * /vocabulary/phrases        → 短语本
 * /vocabulary/:kind/review   → 生词/短语到期复习（翻卡）
 * /settings                  → 学习设置
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
          <Route path="/articles/:id/process" element={<ImportArticlePage />} />
          <Route path={routes.aiConfig} element={<AiConfigPage />} />
          <Route path={routes.discover} element={<DiscoverPage />} />
          <Route path="/discover/:channelId" element={<ChannelPage />} />
          <Route path={routes.vocabWords} element={<VocabBookPage kind="words" />} />
          <Route path={routes.vocabPhrases} element={<VocabBookPage kind="phrases" />} />
          <Route path="/vocabulary/:kind/review" element={<VocabReviewPage />} />
          <Route path={routes.settings} element={<LearningSettingsPage />} />
          <Route path="*" element={<Navigate to={routes.articles} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
