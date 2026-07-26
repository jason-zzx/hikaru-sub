import { isCueActiveAtTime } from "../components/editor/timelineModel";
import { usePlaybackStore } from "../stores/playbackStore";
import { useProjectStore } from "../stores/projectStore";

/**
 * 进程内单例：维护 playbackStore.activeCueIds（当前时间命中的全部 cue，含重叠）。
 *
 * 用 vanilla subscribe 监听 currentTimeMs（60Hz 播放回写）与 projectStore.cues，
 * 只在命中集合内容变化时写回 store——写入频率 = 字幕边界频率，
 * 保证 React 订阅者（SubtitleList / Timeline lane 高亮等）不按帧重渲染。
 * App 挂载时调用 initActiveCueTracker() 一次（参照 previewFontDiscovery 的单例约定）。
 */

let unsubscribers: Array<() => void> | null = null;

function sync() {
  const { currentTimeMs, activeCueIds, setActiveCueIds } =
    usePlaybackStore.getState();
  const { cues } = useProjectStore.getState();
  const next = cues
    .filter((c) => isCueActiveAtTime(c, currentTimeMs))
    .map((c) => c.id);
  const same =
    next.length === activeCueIds.length &&
    next.every((v, i) => v === activeCueIds[i]);
  if (!same) setActiveCueIds(next);
}

/** 幂等初始化：重复调用只挂一次订阅。 */
export function initActiveCueTracker() {
  if (unsubscribers) return;
  unsubscribers = [
    usePlaybackStore.subscribe((state, prev) => {
      if (state.currentTimeMs !== prev.currentTimeMs) sync();
    }),
    useProjectStore.subscribe((state, prev) => {
      if (state.cues !== prev.cues) sync();
    }),
  ];
  sync();
}

/** 测试用：卸载订阅，允许重新 init。 */
export function __resetActiveCueTrackerForTests() {
  if (!unsubscribers) return;
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = null;
}
