/**
 * 频道注册表 — 发现页的数据源注册中心
 * 新增频道只需在 channels 数组中添加一项，架构可扩
 */
import type { LucideIcon } from 'lucide-react'
import { Mic, Radio, Globe } from 'lucide-react'

export interface Channel {
  id: string
  name: string
  description: string
  icon: LucideIcon
  available: boolean
}

export const channels: Channel[] = [
  {
    id: 'ted',
    name: 'TED',
    description: 'TED Talks Daily — 来自世界顶尖思想者的启发性演讲',
    icon: Mic,
    available: true,
  },
  {
    id: 'bbc',
    name: 'BBC 6 Minute English',
    description: 'BBC 6 分钟英语 — 适合中级学习者的短篇英语课程',
    icon: Radio,
    available: false,
  },
  {
    id: 'voa',
    name: 'VOA Learning English',
    description: 'VOA 慢速英语 — 美国之音特别英语学习频道',
    icon: Globe,
    available: false,
  },
]

/** 按 ID 查找频道 */
export function getChannel(id: string): Channel | undefined {
  return channels.find((c) => c.id === id)
}
