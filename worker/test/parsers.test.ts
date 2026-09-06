import { describe, test, expect } from 'vitest'
import {
  parseRss,
  cleanTranscript,
  computeVersion,
  extractNextData,
  pickThumbnail,
} from '../src/parsers'
import type { GraphQLResponse, Talk } from '../src/types'

// ---------------------------------------------------------------------------
// Fixture：贴近真实 TED RSS 结构
// ---------------------------------------------------------------------------

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:acast="https://acast.com/rss">
  <channel>
    <title>TED Talks Daily</title>
    <item>
      <title>How to build a better future | Jane Doe</title>
      <pubDate>Sat, 05 Sep 2026 15:00:00 GMT</pubDate>
      <itunes:duration>18:30</itunes:duration>
      <link>http://go.ted.com/janedoe</link>
      <description><![CDATA[<p>A talk about the future. Learn more &amp; grow.</p>]]></description>
      <acast:episodeUrl>tid188003tid</acast:episodeUrl>
    </item>
    <item>
      <title>The science of sleep | John Smith</title>
      <pubDate>Thu, 03 Sep 2026 15:00:00 GMT</pubDate>
      <itunes:duration>1:05:20</itunes:duration>
      <link>http://go.ted.com/johnsmith</link>
      <description><![CDATA[<p>Why we sleep. &quot;Rest&quot; is vital &amp; restorative.</p>]]></description>
      <acast:episodeUrl>tid187002tid</acast:episodeUrl>
    </item>
  </channel>
</rss>`

// 缺失字段 item（无 pubDate / duration / acast:episodeUrl）
const RSS_PARTIAL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>TED Talks Daily</title>
    <item>
      <title>Title only</title>
      <link>http://go.ted.com/foo</link>
      <description>No tags here</description>
    </item>
  </channel>
</rss>`

// ---------------------------------------------------------------------------
// parseRss
// ---------------------------------------------------------------------------

describe('parseRss', () => {
  test('正常解析所有字段', () => {
    const talks = parseRss(RSS_XML)
    expect(talks).toHaveLength(2)

    const t1 = talks[0]
    expect(t1.title).toBe('How to build a better future')
    expect(t1.presenter).toBe('Jane Doe')
    expect(t1.pubDate).toBe('2026-09-05T15:00:00.000Z')
    expect(t1.durationSec).toBe(18 * 60 + 30)
    expect(t1.link).toBe('http://go.ted.com/janedoe')
    expect(t1.summary).toBe('A talk about the future. Learn more & grow.')
    expect(t1.videoId).toBe('188003')

    // h:mm:ss 时长换算
    const t2 = talks[1]
    expect(t2.durationSec).toBe(1 * 3600 + 5 * 60 + 20)
    expect(t2.videoId).toBe('187002')
    // &quot; → "，&amp; → &
    expect(t2.summary).toBe('Why we sleep. "Rest" is vital & restorative.')
  })

  test('标题无分隔符时讲者为空', () => {
    const talks = parseRss(RSS_PARTIAL)
    expect(talks).toHaveLength(1)
    expect(talks[0].title).toBe('Title only')
    expect(talks[0].presenter).toBe('')
  })

  test('缺失字段以默认值填充', () => {
    const talks = parseRss(RSS_PARTIAL)
    const t = talks[0]
    expect(t.pubDate).toBe('')
    expect(t.durationSec).toBe(0)
    expect(t.videoId).toBe('')
    expect(t.summary).toBe('No tags here')
    expect(t.link).toBe('http://go.ted.com/foo')
  })

  test('malformed XML 返回空数组且不抛异常', () => {
    expect(() => parseRss('not xml at all')).not.toThrow()
    expect(parseRss('not xml at all')).toEqual([])
    expect(parseRss('<<<broken>>><item')).toEqual([])
    expect(parseRss('<rss><channel></channel></rss>')).toEqual([])
  })

  test('空字符串返回空数组', () => {
    expect(parseRss('')).toEqual([])
  })

  test('纯秒数 duration 也能解析', () => {
    const xml = `<rss><channel><item>
      <title>T | P</title><itunes:duration>725</itunes:duration>
    </item></channel></rss>`
    expect(parseRss(xml)[0].durationSec).toBe(725)
  })
})

// ---------------------------------------------------------------------------
// cleanTranscript
// ---------------------------------------------------------------------------

describe('cleanTranscript', () => {
  test('拼接 cues、替换换行、段落双换行、实体解码', () => {
    const data: GraphQLResponse = {
      data: {
        translation: {
          paragraphs: [
            {
              cues: [
                { text: 'Hello world.', startTime: 0, endTime: 1000 },
                { text: 'This is a test.\nNewline here.', startTime: 1000, endTime: 2000 },
              ],
            },
            {
              cues: [{ text: 'Second paragraph &amp; done.', startTime: 2000, endTime: 3000 }],
            },
          ],
        },
      },
    }
    expect(cleanTranscript(data)).toBe(
      'Hello world. This is a test. Newline here.\n\nSecond paragraph & done.',
    )
  })

  test('translation 为 null（transcript 未上线）返回空串', () => {
    const data: GraphQLResponse = { data: { translation: null } }
    expect(cleanTranscript(data)).toBe('')
  })

  test('缺失 paragraphs 返回空串', () => {
    expect(cleanTranscript({ data: { translation: { paragraphs: [] } } })).toBe('')
  })

  test('空 cues 段落被过滤', () => {
    const data: GraphQLResponse = {
      data: {
        translation: {
          paragraphs: [
            { cues: [{ text: 'Real content', startTime: 0, endTime: 1 }] },
            { cues: [] },
          ],
        },
      },
    }
    expect(cleanTranscript(data)).toBe('Real content')
  })

  test('数字实体解码（&#39; → 引号）', () => {
    const data: GraphQLResponse = {
      data: {
        translation: {
          paragraphs: [{ cues: [{ text: 'It&#39;s OK', startTime: 0, endTime: 1 }] }],
        },
      },
    }
    expect(cleanTranscript(data)).toBe("It's OK")
  })
})

// ---------------------------------------------------------------------------
// computeVersion
// ---------------------------------------------------------------------------

describe('computeVersion', () => {
  const baseTalk: Talk = {
    id: '188003',
    title: 'How to build a better future',
    presenter: 'Jane Doe',
    summary: 'summary',
    durationSec: 1110,
    pubDate: '2026-09-05T15:00:00.000Z',
    thumbnailUrl: 'https://img.ted.com/thumb.jpg',
    canonicalUrl: 'https://www.ted.com/talks/jane',
    transcriptAvailable: true,
  }

  test('输出 8 位十六进制', () => {
    const v = computeVersion([baseTalk])
    expect(v).toMatch(/^[0-9a-f]{8}$/)
  })

  test('相同内容产生相同版本（确定性）', () => {
    const a = computeVersion([baseTalk])
    const b = computeVersion([baseTalk])
    expect(a).toBe(b)
  })

  test('内容变化版本随之变化', () => {
    const v1 = computeVersion([baseTalk])
    const changed: Talk = { ...baseTalk, title: 'Different title' }
    const v2 = computeVersion([changed])
    expect(v1).not.toBe(v2)
  })

  test('列表顺序不同则版本不同', () => {
    const t2: Talk = { ...baseTalk, id: '187002', presenter: 'John Smith' }
    const v1 = computeVersion([baseTalk, t2])
    const v2 = computeVersion([t2, baseTalk])
    expect(v1).not.toBe(v2)
  })

  test('缩略图 / canonicalUrl 等富化字段不影响版本', () => {
    const v1 = computeVersion([baseTalk])
    const v2 = computeVersion([
      { ...baseTalk, thumbnailUrl: 'other', canonicalUrl: 'other', transcriptAvailable: false },
    ])
    expect(v1).toBe(v2)
  })

  test('空列表版本稳定', () => {
    expect(computeVersion([])).toBe(computeVersion([]))
  })
})

// ---------------------------------------------------------------------------
// extractNextData
// ---------------------------------------------------------------------------

describe('extractNextData', () => {
  test('从演讲页 HTML 提取 __NEXT_DATA__ JSON', () => {
    const next = { props: { pageProps: { videoData: { videoPlayerData: { duration: 1110 } } } } }
    const html = `<html><head>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>
    </head><body></body></html>`
    const result = extractNextData(html)
    expect(result).not.toBeNull()
    expect(result?.props?.pageProps?.videoData?.videoPlayerData?.duration).toBe(1110)
  })

  test('属性顺序不同也能匹配', () => {
    const next = { props: {} }
    const html = `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify(next)}</script>`
    expect(extractNextData(html)).not.toBeNull()
  })

  test('无 __NEXT_DATA__ 返回 null', () => {
    expect(extractNextData('<html><body>no script</body></html>')).toBeNull()
  })

  test('JSON 格式损坏返回 null', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{not valid json}</script>`
    expect(extractNextData(html)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// pickThumbnail
// ---------------------------------------------------------------------------

describe('pickThumbnail', () => {
  test('优先选 16:9 变体', () => {
    const images = [
      { url: 'https://img/4x3.jpg', aspectRatioName: '4:3' },
      { url: 'https://img/16x9.jpg', aspectRatioName: '16:9' },
    ]
    expect(pickThumbnail(images)).toBe('https://img/16x9.jpg')
  })

  test('无 16:9 时取第一张', () => {
    const images = [
      { url: 'https://img/a.jpg', aspectRatioName: '4:3' },
      { url: 'https://img/b.jpg', aspectRatioName: '1:1' },
    ]
    expect(pickThumbnail(images)).toBe('https://img/a.jpg')
  })

  test('空数组返回空串', () => {
    expect(pickThumbnail([])).toBe('')
  })

  test('undefined 返回空串', () => {
    expect(pickThumbnail(undefined)).toBe('')
  })

  test('无 aspectRatioName 时取第一张', () => {
    expect(pickThumbnail([{ url: 'https://img/x.jpg' }])).toBe('https://img/x.jpg')
  })
})
