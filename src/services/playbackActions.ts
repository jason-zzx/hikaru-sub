import { useProjectStore } from "../stores/projectStore";
import { usePlaybackStore } from "../stores/playbackStore";

/**
 * 播放当前选中行（R / play-segment 与控制条按钮共用实现）：
 * - 片段播放进行中再次触发 = 暂停中断（setPlaying(false) 内清除 playUntilMs）；
 * - 否则 seek 到选中行起点，播放到 endMs 自动停止；
 * - 无选中行时 no-op。
 */
export function playSelectedCueSegment() {
  const pb = usePlaybackStore.getState();
  if (pb.isPlaying && pb.playUntilMs !== null) {
    pb.setPlaying(false); // setPlaying(false) 内清除 playUntilMs
    return;
  }
  const cue = useProjectStore
    .getState()
    .cues.find((c) => c.id === pb.selectedCueId);
  if (!cue) return;
  pb.requestSeek(cue.startMs);
  pb.setPlayUntil(cue.endMs);
  pb.setPlaying(true);
}
