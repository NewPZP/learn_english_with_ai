import { useEffect } from 'react'
import { addStudyMs } from './studyProgress'

const DEFAULT_IDLE_MS = 60_000
const DEFAULT_TICK_MS = 10_000

/**
 * 学习时长追踪（工单 #11）：挂载于学习页面（词汇预习/播客/听力训练）
 * 按活跃心跳累计今日学习时长——每 tick 结算距上次心跳的间隔，
 * 距最近一次用户交互超过 idle 阈值则不计入（挂机不累计）；
 * 卸载时结算最后一段活跃时长；跨天归零由存储层日期键保证
 */
export function useStudyTimeTracker(idleMs = DEFAULT_IDLE_MS, tickMs = DEFAULT_TICK_MS): void {
  useEffect(() => {
    let lastActivity = Date.now()
    let lastTick = Date.now()

    const bump = () => {
      lastActivity = Date.now()
    }
    window.addEventListener('pointerdown', bump)
    window.addEventListener('keydown', bump)

    const timer = window.setInterval(() => {
      const now = Date.now()
      if (now - lastActivity <= idleMs) addStudyMs(now - lastTick)
      lastTick = now
    }, tickMs)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('keydown', bump)
      // 卸载结算最后一段活跃时间
      const now = Date.now()
      if (now - lastActivity <= idleMs) addStudyMs(Math.max(0, now - lastTick))
    }
  }, [idleMs, tickMs])
}
