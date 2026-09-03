import { PageWithTopbarSkeleton } from '../components/AppLayout'

/** 播客模式页（骨架）：播放器/字幕同步由「播客模式」工单实现 */
export function PodcastPage() {
  return <PageWithTopbarSkeleton title="播客模式" />
}

/** 听力训练页（骨架）：逐句精听/听力挑战由对应工单实现 */
export function IntensiveListeningPage() {
  return <PageWithTopbarSkeleton title="听力训练" />
}
