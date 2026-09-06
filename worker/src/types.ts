/**
 * 类型定义 — Worker 各模块共享的数据契约。
 *
 * 这些类型同时约束纯函数（parsers.ts）与 Worker 运行时（index.ts），
 * 使 RSS 解析结果、演讲快照、transcript 响应等在端到端保持一致。
 */

/** RSS 解析后、尚未抓取演讲页的原始演讲信息。 */
export interface RawTalk {
  /** 演讲标题（已按 " | " 分割出讲者） */
  title: string
  /** 讲者姓名，无分隔符时为空串 */
  presenter: string
  /** 简介（已去 HTML 标签、解码实体） */
  summary: string
  /** 时长（秒）；mm:ss / h:mm:ss 已换算 */
  durationSec: number
  /** 发布时间，ISO 字符串；解析失败时保留原始文本 */
  pubDate: string
  /** TED 视频 ID（从 acast:episodeUrl 的 tid{ID}tid 提取） */
  videoId: string
  /** go.ted.com 短链（原始 RSS link） */
  link: string
}

/** 抓取演讲页并提取 __NEXT_DATA__ 后的完整演讲信息。 */
export interface Talk {
  id: string
  title: string
  presenter: string
  summary: string
  durationSec: number
  pubDate: string
  /** 16:9 缩略图；抓取失败时为空串 */
  thumbnailUrl: string
  /** 规范 URL（ted.com/talks/{slug}）；抓取失败时为空串 */
  canonicalUrl: string
  /** 是否疑似可用 transcript（演讲页含 transcriptData.video.id） */
  transcriptAvailable: boolean
}

/** 频道列表项。 */
export interface Channel {
  id: string
  name: string
  description: string
  icon: string
  available: boolean
}

/** TED GraphQL transcript 接口的响应结构。 */
export interface GraphQLCue {
  text: string
  startTime: number
  endTime: number
}

export interface GraphQLParagraph {
  cues: GraphQLCue[]
}

export interface GraphQLResponse {
  data: {
    /** transcript 未上线时为 null（最新演讲常见） */
    translation: {
      paragraphs: GraphQLParagraph[]
    } | null
  }
}

/** 演讲页 __NEXT_DATA__ JSON blob 中我们关心的结构（部分字段）。 */
export interface NextData {
  props?: {
    pageProps?: {
      videoData?: {
        videoPlayerData?: {
          duration?: number
          canonical?: string
          primaryImageSet?: PrimaryImage[]
        }
      }
      transcriptData?: {
        video?: {
          id?: string
        }
      }
    }
  }
}

export interface PrimaryImage {
  url: string
  /** 形如 "16:9" / "4:3" 的宽高比标识 */
  aspectRatioName?: string
}

/** 每日刷新后缓存的 TED 演讲快照。 */
export interface TalkSnapshot {
  version: string
  talks: Talk[]
  /** 抓取时间戳（ms），用于判断 24h 过期 */
  fetchedAt: number
}

/** Worker 环境变量。 */
export interface Env {
  /** 鉴权 token；开发期缺省 "dev-token"，生产通过 wrangler secret 设置 */
  API_TOKEN?: string
}
