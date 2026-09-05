import { describe, test, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { formatTime, PLAYBACK_RATES, sentenceIndexAt, useSentencePlayer } from './useSentencePlayer'
import type { AudioLike } from './useSentencePlayer'

/**
 * 工单「播客模式」验收测试 — 句级播放器（可复用组件，供逐句精听复用）
 * 通过注入假音频元素验证：播放/暂停、进度定位、上下句、重复、倍速、句索引推导
 */

const SENTENCES = [
  { text: 'First sentence.', startMs: 0, endMs: 8000 },
  { text: 'Second sentence.', startMs: 8000, endMs: 20000 },
  { text: 'Third sentence.', startMs: 20000, endMs: 35000 },
]

const DURATION_MS = 36000 // 0:36

/** 可控假音频：记录指令、手动触发 timeupdate 推进时间 */
function createFakeAudio() {
  const listeners = new Map<string, Set<() => void>>()
  const audio = {
    currentTime: 0,
    playbackRate: 1,
    playCalls: 0,
    pauseCalls: 0,
    play: vi.fn(() => {
      audio.playCalls += 1
    }),
    pause: vi.fn(() => {
      audio.pauseCalls += 1
    }),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    }),
    /** 模拟播放器时钟：推进 currentTime 并广播 timeupdate */
    tick(seconds: number) {
      audio.currentTime += seconds
      for (const listener of listeners.get('timeupdate') ?? []) listener()
    },
    /** 模拟播放到结尾 */
    finish() {
      audio.currentTime = DURATION_MS / 1000
      for (const listener of listeners.get('ended') ?? []) listener()
    },
  }
  return audio
}

type FakeAudio = ReturnType<typeof createFakeAudio>

function renderPlayer(fake: FakeAudio) {
  const utils = renderHook(() =>
    useSentencePlayer({
      audioUrl: 'data:audio/wav;base64,x',
      sentences: SENTENCES,
      durationMs: DURATION_MS,
      createAudio: () => fake as unknown as AudioLike,
    }),
  )
  return utils
}

describe('纯函数', () => {
  test('formatTime：m:ss 格式', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(8000)).toBe('0:08')
    expect(formatTime(75000)).toBe('1:15')
  })

  test('sentenceIndexAt：按时间轴推导当前句，越界钳制', () => {
    expect(sentenceIndexAt(SENTENCES, 0)).toBe(0)
    expect(sentenceIndexAt(SENTENCES, 7999)).toBe(0)
    expect(sentenceIndexAt(SENTENCES, 10000)).toBe(1)
    expect(sentenceIndexAt(SENTENCES, 34000)).toBe(2)
    // 超出最后一句终点 → 停在最后一句
    expect(sentenceIndexAt(SENTENCES, DURATION_MS)).toBe(2)
    expect(sentenceIndexAt([], 0)).toBe(-1)
  })
})

describe('播放控制', () => {
  test('初始状态：未播放、0 位置、1 倍速、首句', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)
    expect(result.current.playing).toBe(false)
    expect(result.current.currentTimeMs).toBe(0)
    expect(result.current.playbackRate).toBe(1)
    expect(result.current.currentIndex).toBe(0)
  })

  test('play/pause 调用媒体元素并更新状态', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)

    act(() => result.current.play())
    expect(result.current.playing).toBe(true)
    expect(fake.play).toHaveBeenCalledTimes(1)

    act(() => result.current.pause())
    expect(result.current.playing).toBe(false)
    expect(fake.pause).toHaveBeenCalledTimes(1)
  })

  test('togglePlay 在播放/暂停间切换', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)

    act(() => result.current.togglePlay())
    expect(result.current.playing).toBe(true)
    act(() => result.current.togglePlay())
    expect(result.current.playing).toBe(false)
  })

  test('timeupdate 推进时间且当前句随时间轴切换', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)
    act(() => result.current.play())

    // 推进 10 秒 → 进入第二句
    act(() => fake.tick(10))
    expect(result.current.currentTimeMs).toBe(10000)
    expect(result.current.currentIndex).toBe(1)

    act(() => fake.tick(12))
    expect(result.current.currentTimeMs).toBe(22000)
    expect(result.current.currentIndex).toBe(2)
  })

  test('播放越界：暂停并停在总时长', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)
    act(() => result.current.play())

    act(() => fake.tick(40))
    expect(result.current.currentTimeMs).toBe(DURATION_MS)
    expect(result.current.playing).toBe(false)
    expect(fake.pause).toHaveBeenCalled()
  })

  test('单句模式：到达当前句末尾自动暂停', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)
    act(() => result.current.setStopAfterSentence(true))
    act(() => result.current.play())

    // 第 0 句 endMs = 8000ms；推进到 9 秒 → 越过句尾 → 暂停
    act(() => fake.tick(9))
    expect(result.current.playing).toBe(false)
    expect(fake.pause).toHaveBeenCalled()
    // 当前位置停在越过句尾处（不会继续播放）
    expect(result.current.currentTimeMs).toBe(9000)
  })

  test('连续模式（默认）：越过句尾不暂停，继续播放', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)
    act(() => result.current.play())

    act(() => fake.tick(9))
    expect(result.current.playing).toBe(true)
    expect(result.current.currentIndex).toBe(1)
  })

  test('ended 事件：回到未播放态', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)
    act(() => result.current.play())

    act(() => fake.finish())
    expect(result.current.playing).toBe(false)
    expect(result.current.currentTimeMs).toBe(DURATION_MS)
  })
})

describe('句级控制', () => {
  test('goToSentence 定位到句起点', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)

    act(() => result.current.goToSentence(2))
    expect(result.current.currentTimeMs).toBe(20000)
    expect(result.current.currentIndex).toBe(2)
    expect(fake.currentTime).toBe(20)
  })

  test('seekToMs 钳制到 [0, duration]，供进度条拖拽', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)

    act(() => result.current.seekToMs(-5000))
    expect(result.current.currentTimeMs).toBe(0)
    act(() => result.current.seekToMs(999999))
    expect(result.current.currentTimeMs).toBe(DURATION_MS)
    expect(result.current.playing).toBe(false)
  })

  test('next/prev 在边界钳制', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)

    act(() => result.current.prevSentence())
    expect(result.current.currentTimeMs).toBe(0) // 已在首句

    act(() => result.current.nextSentence())
    expect(result.current.currentTimeMs).toBe(8000)
    act(() => result.current.nextSentence())
    expect(result.current.currentTimeMs).toBe(20000)
    act(() => result.current.nextSentence())
    expect(result.current.currentTimeMs).toBe(20000) // 末句停留

    act(() => result.current.prevSentence())
    expect(result.current.currentTimeMs).toBe(8000)
  })

  test('repeatSentence 回到当前句起点', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)
    act(() => result.current.play())
    act(() => fake.tick(12)) // 第二句中段

    act(() => result.current.repeatSentence())
    expect(result.current.currentTimeMs).toBe(8000)
    expect(result.current.currentIndex).toBe(1)
  })
})

describe('倍速', () => {
  test('setPlaybackRate 写入媒体元素并更新状态', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)

    act(() => result.current.setPlaybackRate(1.5))
    expect(fake.playbackRate).toBe(1.5)
    expect(result.current.playbackRate).toBe(1.5)
  })

  test('cyclePlaybackRate 按 0.5/1.0/1.5/2.0 循环并回到 1.0', () => {
    const fake = createFakeAudio()
    const { result } = renderPlayer(fake)

    const rates: number[] = []
    act(() => rates.push(result.current.cyclePlaybackRate()))
    act(() => rates.push(result.current.cyclePlaybackRate()))
    act(() => rates.push(result.current.cyclePlaybackRate()))
    act(() => rates.push(result.current.cyclePlaybackRate()))
    expect(rates).toEqual([1.5, 2, 0.5, 1])
    expect(result.current.playbackRate).toBe(1)
    expect(PLAYBACK_RATES).toEqual([0.5, 1, 1.5, 2])
  })
})

describe('卸载与重挂载', () => {
  test('卸载时暂停并移除监听', () => {
    const fake = createFakeAudio()
    const { result, unmount } = renderPlayer(fake)
    act(() => result.current.play())

    unmount()
    expect(fake.pause).toHaveBeenCalled()
    expect(fake.removeEventListener).toHaveBeenCalled()
  })
})
