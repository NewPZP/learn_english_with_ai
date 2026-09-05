import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Clock,
  FileText,
  Headphones,
  Link2,
  Mic,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Sparkles,
} from 'lucide-react'
import { PageTopbar } from '../components/AppLayout'
import { getArticle } from '../lib/articles'
import { routes } from '../routes'
import {
  formatTime,
  useSentencePlayer,
  type AudioFactory,
} from '../lib/audio/useSentencePlayer'
import { savePodcastProgress } from '../lib/studyProgress'
import { useStudyTimeTracker } from '../lib/useStudyTimeTracker'

/** 倍速显示文案：1 → 1.0x */
function speedLabel(rate: number): string {
  return `${rate.toFixed(1)}x`
}

/**
 * 播客模式页：整篇播放 + 字幕同步高亮 + 句子级控制
 * 音频来自 AI 处理管道的语音产物（article.processing.audio），句级时间轴驱动字幕同步
 * createAudio 可注入媒体元素（测试接缝，默认 new Audio()）
 */
export function PodcastPage({ createAudio }: { createAudio?: AudioFactory }) {
  const { id } = useParams<{ id: string }>()
  const article = useMemo(() => (id ? getArticle(id) : undefined), [id])
  const processing = article?.processing
  const sentences = processing?.sentences ?? []
  const audio = processing?.audio ?? null

  const player = useSentencePlayer({
    audioUrl: audio?.audioUrl ?? '',
    sentences,
    durationMs: audio?.durationMs ?? 0,
    createAudio,
  })

  useStudyTimeTracker()

  /**
   * 收听进度持久化：记录最远收听位置（回拖重听不回退进度）
   * 位置每次变化即保存，供文章列表卡片回显播客百分比
   */
  const furthestMsRef = useRef(0)
  // 路由参数变化不重挂载（如浏览器前进/后退），切换文章时重置最远位置
  useEffect(() => {
    furthestMsRef.current = 0
  }, [id])
  useEffect(() => {
    if (!id) return
    furthestMsRef.current = Math.max(furthestMsRef.current, player.currentTimeMs)
    savePodcastProgress(id, furthestMsRef.current, audio?.durationMs ?? 0)
  }, [id, player.currentTimeMs, audio?.durationMs])

  /** 跟读模式开关：仅 UI 状态（录音功能由后续工单接入） */
  const [readAlong, setReadAlong] = useState(false)
  /** 右栏句子列表折叠态 */
  const [listExpanded, setListExpanded] = useState(true)

  // 当前句字幕自动滚动到可视区
  const currentLineRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    currentLineRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [player.currentIndex])

  if (!article || !audio) {
    const missing = article && !audio
    return (
      <>
        <PageTopbar title="播客模式" />
        <div className="app-content-inner">
          <div className="empty-state" data-testid="podcast-empty">
            <Headphones size={32} />
            <span className="empty-state-title">{missing ? '本文尚未生成音频' : '暂无语音产物'}</span>
            <span className="empty-state-hint">
              {missing ? '先用 AI 预处理生成语音，再回来收听' : '请先导入文章'}
            </span>
            {missing && (
              <Link
                to={routes.articleProcess(article.id)}
                className="function-btn function-btn-primary"
                data-dom-id="cta-ai-process"
              >
                <Sparkles size={16} />
                <span>去 AI 预处理</span>
              </Link>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTopbar title="播客模式" />
      <div className="app-content-inner">
        <div className="podcast-columns">
          {/* 左栏：信息卡 + 字幕 + 播放控制 */}
          <div className="podcast-left-col">
            <section className="info-card" data-testid="podcast-info-card">
              <h1 className="info-card-title">{article.title}</h1>
              <div className="info-card-meta">
                <span>{article.source}</span>
                <span className="dot" />
                <span className="info-card-duration">
                  <Clock size={14} />
                  {formatTime(audio.durationMs)}
                </span>
              </div>
              <div className="info-card-badges">
                <span className="stat-badge">
                  <FileText size={14} />
                  {article.wordCount.toLocaleString()} 词
                </span>
                <span className="stat-badge">
                  <BookOpen size={14} />
                  {processing?.words.length ?? 0} 生词
                </span>
                <span className="stat-badge">
                  <Link2 size={14} />
                  {processing?.phrases.length ?? 0} 短语
                </span>
              </div>
            </section>

            <button
              type="button"
              className={`readalong-toggle${readAlong ? ' readalong-on' : ''}`}
              data-dom-id="cta-readalong"
              data-testid="readalong-toggle"
              aria-pressed={readAlong}
              onClick={() => setReadAlong((v) => !v)}
            >
              <Mic size={16} />
              <span>跟读模式{readAlong ? ' · 开' : ''}</span>
            </button>

            <section className="subtitle-area" data-testid="subtitle-area">
              {sentences.map((sentence, index) => (
                <p
                  key={index}
                  ref={index === player.currentIndex ? currentLineRef : undefined}
                  className={`subtitle-line${
                    index === player.currentIndex ? ' current' : index < player.currentIndex ? '' : ' faded'
                  }`}
                  data-sentence-index={index}
                  data-testid={`subtitle-line-${index}`}
                >
                  {index === player.currentIndex && player.playing && (
                    <span className="playing-dot" aria-hidden="true" />
                  )}
                  {sentence.text}
                </p>
              ))}
            </section>

            <section className="player-controls">
              <input
                type="range"
                className="progress-slider"
                min={0}
                max={audio.durationMs}
                step={100}
                value={player.currentTimeMs}
                style={{
                  ['--progress-percent' as string]: `${
                    audio.durationMs ? (player.currentTimeMs / audio.durationMs) * 100 : 0
                  }%`,
                }}
                aria-label="播放进度"
                data-dom-id="podcast-progress"
                data-testid="progress-slider"
                onChange={(e) => player.seekToMs(Number(e.target.value))}
              />
              <div className="time-row">
                <span data-testid="current-time">{formatTime(player.currentTimeMs)}</span>
                <span data-testid="total-time">{formatTime(audio.durationMs)}</span>
              </div>
              <div className="controls-row">
                <button
                  type="button"
                  className="control-btn"
                  aria-label="重复本句"
                  data-dom-id="cta-repeat-sentence"
                  onClick={player.repeatSentence}
                >
                  <Repeat size={24} />
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  aria-label="上一句"
                  data-dom-id="cta-prev-sentence"
                  onClick={player.prevSentence}
                >
                  <SkipBack size={28} />
                </button>
                <button
                  type="button"
                  className="play-button"
                  aria-label={player.playing ? '暂停' : '播放'}
                  data-dom-id="cta-play-pause"
                  data-testid="play-pause"
                  onClick={player.togglePlay}
                >
                  {player.playing ? <Pause size={28} /> : <Play size={28} />}
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  aria-label="下一句"
                  data-dom-id="cta-next-sentence"
                  onClick={player.nextSentence}
                >
                  <SkipForward size={28} />
                </button>
                <button
                  type="button"
                  className="speed-btn"
                  aria-label="播放速度"
                  data-dom-id="cta-playback-speed"
                  data-testid="speed-button"
                  onClick={player.cyclePlaybackRate}
                >
                  {speedLabel(player.playbackRate)}
                </button>
              </div>
            </section>
          </div>

          {/* 右栏：全部句子列表（可折叠） */}
          <section className="sentence-panel">
            <button
              type="button"
              className="sentence-list-header"
              aria-expanded={listExpanded}
              data-testid="sentence-list-toggle"
              onClick={() => setListExpanded((v) => !v)}
            >
              <span className="sentence-list-title">
                全部句子 <span className="sentence-count nums">{sentences.length} 句</span>
              </span>
              <ChevronDown size={20} className={`chevron${listExpanded ? ' chevron-up' : ''}`} />
            </button>
            {listExpanded && (
              <div className="sentence-list" data-testid="sentence-list">
                {sentences.map((sentence, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`sentence-row${index === player.currentIndex ? ' current' : ''}`}
                    data-sentence-index={index}
                    data-testid={`sentence-row-${index}`}
                    onClick={() => player.goToSentence(index)}
                  >
                    <span className="sentence-num nums">{index + 1}</span>
                    <span className="sentence-text">{sentence.text}</span>
                    <span className="sentence-duration nums">
                      {formatTime(sentence.endMs - sentence.startMs)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
