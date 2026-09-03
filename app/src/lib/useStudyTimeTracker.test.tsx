import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { useStudyTimeTracker } from './useStudyTimeTracker'
import { getTodayStudyMs } from './studyProgress'

/**
 * 工单 #11 验收测试 — 学习时长追踪 hook
 * 覆盖：活跃时段按心跳累计、空闲（挂机）不累计、卸载结算尾段
 */

function Host(props: { idleMs?: number; tickMs?: number }) {
  useStudyTimeTracker(props.idleMs, props.tickMs)
  return <div>host</div>
}

describe('useStudyTimeTracker', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('活跃时段按心跳累计今日时长', () => {
    const { unmount } = render(<Host tickMs={10_000} />)

    // 挂载即活跃，10s/20s/30s 三次心跳各结算 10s
    vi.advanceTimersByTime(30_000)
    expect(getTodayStudyMs()).toBe(30_000)
    unmount()
  })

  test('交互刷新活跃窗口', () => {
    const { unmount } = render(<Host idleMs={20_000} tickMs={10_000} />)

    vi.advanceTimersByTime(15_000) // 10s 心跳结算 10s
    fireEvent.pointerDown(window) // 15s 时交互，刷新窗口
    vi.advanceTimersByTime(10_000) // 20s 心跳：距交互 5s ≤ 20s → 结算 10s
    expect(getTodayStudyMs()).toBe(20_000)
    unmount()
  })

  test('挂机（超过空闲阈值）不累计', () => {
    const { unmount } = render(<Host idleMs={15_000} tickMs={10_000} />)

    vi.advanceTimersByTime(10_000) // 活跃：10s
    vi.advanceTimersByTime(60_000) // 无交互挂机：后续心跳距上次活动 > 15s，不结算
    expect(getTodayStudyMs()).toBe(10_000)
    unmount()
  })

  test('卸载结算尾段活跃时间', () => {
    const { unmount } = render(<Host tickMs={10_000} />)

    vi.advanceTimersByTime(5_000) // 不足一个心跳
    unmount() // 卸载结算 5s
    expect(getTodayStudyMs()).toBe(5_000)
  })

  test('挂机后卸载不重复累计', () => {
    const { unmount } = render(<Host idleMs={15_000} tickMs={10_000} />)

    vi.advanceTimersByTime(10_000) // 活跃：10s
    vi.advanceTimersByTime(60_000) // 挂机
    unmount() // 距上次活动 > 15s → 不结算
    expect(getTodayStudyMs()).toBe(10_000)
  })
})
