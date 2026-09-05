/**
 * 句级音频播放器（PRD 测试接缝：媒体元素可注入）
 * 播客模式与逐句精听共用：整篇音频 + 句级时间轴 → 播放/暂停/定位/上下句/重复/倍速
 * 音频元素通过 createAudio 工厂注入（页面默认用 new Audio()，测试注入可控假件）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sentence } from '../ai/types'

/** 播放器依赖的最小媒体元素接口（HTMLAudioElement 的结构子类型） */
export interface AudioLike {
  play(): Promise<void> | void
  pause(): void
  currentTime: number
  playbackRate: number
  addEventListener(type: 'timeupdate' | 'ended', listener: () => void): void
  removeEventListener(type: 'timeupdate' | 'ended', listener: () => void): void
}

export type AudioFactory = (url: string) => AudioLike

export const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const

/** 播放器对外状态与控制 */
export interface SentencePlayer {
  playing: boolean
  /** 当前播放位置（毫秒） */
  currentTimeMs: number
  /** 音频总时长（毫秒），取自 TTS 元数据 */
  durationMs: number
  playbackRate: number
  /** 当前句下标（按时间轴推导；播放结束停 in 最后一句） */
  currentIndex: number
  /** 单句模式：开启后播放到当前句结束自动暂停 */
  stopAfterSentence: boolean
  setStopAfterSentence: (value: boolean) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  /** 定位到任意毫秒位置（进度条拖拽） */
  seekToMs: (ms: number) => void
  /** 跳到某句起点（列表点击） */
  goToSentence: (index: number) => void
  nextSentence: () => void
  prevSentence: () => void
  /** 重复本句：回到当前句起点 */
  repeatSentence: () => void
  setPlaybackRate: (rate: number) => void
  /** 循环切换到下一档倍速，返回新倍速 */
  cyclePlaybackRate: () => number
}

const defaultCreateAudio: AudioFactory = (url) => new Audio(url) as unknown as AudioLike

/** 由播放位置推导当前句下标：首个包含该时刻的句子；越界钳制到最后一句 */
export function sentenceIndexAt(sentences: Sentence[], timeMs: number): number {
  if (sentences.length === 0) return -1
  for (let i = 0; i < sentences.length; i++) {
    if (timeMs < sentences[i].endMs) return i
  }
  return sentences.length - 1
}

export function useSentencePlayer(options: {
  audioUrl: string
  sentences: Sentence[]
  durationMs: number
  createAudio?: AudioFactory
}): SentencePlayer {
  const { audioUrl, sentences, durationMs, createAudio = defaultCreateAudio } = options

  const audioRef = useRef<AudioLike | null>(null)
  /** 工厂引用固定在 ref：避免调用方每次渲染传新函数导致事件重订阅 */
  const createAudioRef = useRef(createAudio)
  useEffect(() => {
    createAudioRef.current = createAudio
  })
  const [playing, setPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [playbackRate, setRate] = useState(1)
  const [stopAfterSentence, setStopAfterSentence] = useState(false)
  /** ref 镜像：timeupdate 闭包内读取最新值，避免依赖列表频繁重订阅 */
  const stopAfterSentenceRef = useRef(false)
  useEffect(() => {
    stopAfterSentenceRef.current = stopAfterSentence
  }, [stopAfterSentence])
  /** 播放起始句下标：单句模式下越过此句即暂停 */
  const playStartIndexRef = useRef(0)

  // 惰性创建媒体元素（依赖 audioUrl，便于注入替换与卸载清理）
  const getAudio = useCallback((): AudioLike => {
    if (!audioRef.current) {
      audioRef.current = createAudioRef.current(audioUrl)
    }
    return audioRef.current
  }, [audioUrl])

  useEffect(() => {
    // 首次访问媒体元素时注册时间轴事件
    const audio = getAudio()
    const onTimeUpdate = () => {
      const ms = audio.currentTime * 1000
      setCurrentTimeMs(ms)
      if (ms >= durationMs) {
        audio.pause()
        setCurrentTimeMs(durationMs)
        setPlaying(false)
        return
      }
      // 单句模式：越过播放起始句即自动暂停
      if (stopAfterSentenceRef.current) {
        const idx = sentenceIndexAt(sentences, ms)
        if (idx > playStartIndexRef.current) {
          audio.pause()
          setPlaying(false)
        }
      }
    }
    const onEnded = () => {
      setCurrentTimeMs(durationMs)
      setPlaying(false)
    }
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.pause()
    }
  }, [getAudio, durationMs])

  const play = useCallback(() => {
    const audio = getAudio()
    // 已播到末尾时，从头开始（否则浏览器可能重置 currentTime，导致起始句下标计算错误）
    if (audio.currentTime * 1000 >= durationMs) {
      audio.currentTime = 0
    }
    // 记录播放起始句：单句模式下越过此句即暂停
    playStartIndexRef.current = sentenceIndexAt(sentences, audio.currentTime * 1000)
    setPlaying(true)
    // jsdom / 自动播放受限时不抛错：状态乐观推进，实际播放由元素决定
    void Promise.resolve(audio.play()).catch(() => {})
  }, [getAudio, sentences, durationMs])

  const pause = useCallback(() => {
    getAudio().pause()
    setPlaying(false)
  }, [getAudio])

  const togglePlay = useCallback(() => {
    if (playing) pause()
    else play()
  }, [playing, play, pause])

  const seekToMs = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, durationMs))
      const audio = getAudio()
      audio.currentTime = clamped / 1000
      setCurrentTimeMs(clamped)
      if (clamped >= durationMs) setPlaying(false)
    },
    [getAudio, durationMs],
  )

  const goToSentence = useCallback(
    (index: number) => {
      const target = sentences[index]
      if (!target) return
      seekToMs(target.startMs)
    },
    [sentences, seekToMs],
  )

  const currentIndex = useMemo(
    () => sentenceIndexAt(sentences, currentTimeMs),
    [sentences, currentTimeMs],
  )

  const nextSentence = useCallback(() => {
    goToSentence(Math.min(currentIndex + 1, sentences.length - 1))
  }, [goToSentence, currentIndex, sentences.length])

  const prevSentence = useCallback(() => {
    goToSentence(Math.max(currentIndex - 1, 0))
  }, [goToSentence, currentIndex])

  const repeatSentence = useCallback(() => {
    goToSentence(currentIndex)
  }, [goToSentence, currentIndex])

  const setPlaybackRate = useCallback(
    (rate: number) => {
      getAudio().playbackRate = rate
      setRate(rate)
    },
    [getAudio],
  )

  const cyclePlaybackRate = useCallback(() => {
    const idx = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number])
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length]
    setPlaybackRate(next)
    return next
  }, [playbackRate, setPlaybackRate])

  return {
    playing,
    currentTimeMs,
    durationMs,
    playbackRate,
    currentIndex,
    stopAfterSentence,
    setStopAfterSentence,
    play,
    pause,
    togglePlay,
    seekToMs,
    goToSentence,
    nextSentence,
    prevSentence,
    repeatSentence,
    setPlaybackRate,
    cyclePlaybackRate,
  }
}

/** 秒 → m:ss（播客时间显示；不足 1 小时） */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
