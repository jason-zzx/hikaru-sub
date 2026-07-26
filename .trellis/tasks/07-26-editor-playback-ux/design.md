# Design — editor-playback-ux

三个子项相互独立，可分阶段落地与回滚。R3 最小、先行；R2 是主诉痛点；R1 独立于两者。

## R2 播放头平滑与跟手（渲染架构）

### 根因回顾

rAF 每帧 `setCurrentTime`（60Hz）本身正确，问题是裸 `currentTimeMs` 的 React 订阅者过重（PRD「背景」节有逐项成本清单）。设计原则：**60Hz 状态写入保留，昂贵消费者全部改为“边界频率 React 渲染 + 瞬态直连 DOM/canvas”**。不引入新事件总线——zustand 的 vanilla `subscribe` 就是瞬态通道。

### 状态层（playbackStore）

1. `currentTimeMs` 语义不变，rAF 60Hz 写入保留 → 所有 `getState().currentTimeMs` 动作（帧步进、设为行起止、播放头新建字幕）精度不变，零迁移。
2. 新增派生字段 `activeCueIds: string[]`（当前时间命中的全部 cue，含重叠）。由新模块 `src/services/activeCueTracker.ts` 维护：vanilla `subscribe` 监听 `currentTimeMs` + `projectStore.cues`，命中集合变化时才写回 store（写入频率 = 字幕边界频率，非 60Hz）。数组内容比较后才 set，保证订阅者只在边界重渲染。App 挂载时初始化一次（模块单例，参照 `previewFontDiscovery` 的单例约定）。
3. 新增显式 seek 意图：`seekRequest: { ms: number; seq: number } | null` + `requestSeek(ms)`（同时写 `currentTimeMs`）。**用户意图 seek**（进度条、±5s、时间轴点击/拖拽、列表选行、帧步进、边界跳转、播放当前行、进入编辑页选首条、时间输入提交）一律走 `requestSeek`；`setCurrentTime` 只保留给播放回写路径（rAF/timeupdate/暂停收尾/段播终点 snap——这些场景视频本来就在目标位置，无需 seek）。

### VideoPlayer

- 删除 `usePlaybackStore((s) => s.currentTimeMs)` 渲染订阅（`VideoPlayer.tsx:33`）；`handleVideoError` 恢复位置改 `getState()`。
- 外部 seek 效应（`VideoPlayer.tsx:349-407`）依赖从 `[currentTimeMs, ...]` 改为 `[seekRequest, videoSrc]`，消除每帧效应重执行；死区/越界防护/`isSeekingRef`/HAVE_METADATA 门槛逻辑原样保留（死区仍按 `isPlaying` 取 100/5ms）。
- 传给 `SubtitlePreview` 的时间改为哨兵选择器：`usePlaybackStore((s) => (s.isPlaying ? null : s.currentTimeMs))`——播放中 libass 走 rVFC 直连视频帧（`libassVideoSync`）、CSS 兜底靠 `activeCueIds`，都不需要每帧 prop；暂停/seek 时才需要精确时间做 libass 定帧。`null` 时沿用上一次值（组件内 ref 保持），`findPreviewCue`/`getLibassRenderTimeMs` 的兜底时间参数改用 activeCue 边界或保持值，实现时以现测试为准微调。

### Timeline

- 移除 `currentTimeMs` React 订阅。播放头从两块 canvas 中剥离，改为容器内绝对定位的 2px 竖线 div（`pointer-events-none`，z 在 canvas 之上，贯穿 fixed 层与 lane 视口高度），瞬态效应里 `subscribe(currentTimeMs)` → 写 `transform: translateX()`（纯合成层属性，无布局/重绘成本）。
- 自动滚动：同一瞬态订阅内做 `revealTimelineTime` 判断（容器宽度经 ResizeObserver 缓存进 ref），需要翻页时才 `setViewStartMs`（React 状态 → 静态层每屏一次重绘）。拖拽手势中跳过（沿用现有 guard）。
- 静态层重绘依赖：`currentTimeMs` 移出，`activeCueIds` 移入（lane 层 `cuePlaying` 高亮改为 `activeCueIds.includes(cue.id)`）。手势快照里的 `playheadMs`（`Timeline.tsx:469/486/632`）改 `getState().currentTimeMs`。
- 重绘成本顺手修复（同文件、防止边界频率重绘仍卡）：
  - `prepareCanvas` 仅在 width/height/dpr 变化时重设 canvas 尺寸，否则只 `clearRect`；
  - `resolveTimelineColors` 结果按 `themeVersion` 用 `useMemo` 缓存，不再每次重绘 `getComputedStyle`。

### SubtitleList / PlaybackControls

- `SubtitleList.tsx:98` 裸时间订阅改为 `activeCueIds` 订阅；行高亮（`:319`）与激活判断（`:282-283`）改 id 比较；动作里需要即时时间处（`:443` 一带）改 `getState()`。整表重渲染频率从 60Hz 降到字幕边界频率。不做虚拟化（PRD Out of Scope）。
- `PlaybackControls` 保留裸订阅（叶子组件，毫秒时间文本本就需要高频刷新）。若验证阶段 Profiler 显示其 60Hz 受控 `<input type=range>` 仍有可感成本，再降级为瞬态 ref 直写（备选项，不默认做）。

### 暂停跟手

不需要专门机制：点击暂停慢是主线程饱和的次生症状。负载移除后，`点击 → setPlaying(false) → video.pause() → rAF cleanup 写终值` 链路本身在数毫秒内完成。回归点：暂停后播放头终值必须与视频帧一致（现有 cleanup 逻辑保留）。

### 行为不变式（回归清单）

段播精确停在 `cue.endMs`；暂停清 `playUntilMs`；暂停后 cue 高亮保持（b04cb2b）；seek 死区与越界防护；剪辑片越界 seek 防护；暂停时帧步进放行。

## R1 波形可辨识度

### 数据（分辨率）

- 前端请求量从固定 4000 改为按时长：`samples = clamp(ceil(durationMs / 10), 4000, 720_000)`（10ms/桶；<40s 素材保持现密度；>2h 桶自动变粗）。Rust `extract_waveform` 已支持 `samples` 参数，无接口改动。
- Rust 侧把峰值圆整到 3 位小数（`(v * 1000.0).round() / 1000.0`）压缩 JSON 载荷（720k 桶最坏情况数 MB，一次性异步加载可接受）。整段解码内存峰值（16kHz s16le，2h ≈ 230MB）为既有行为，不在本任务处理。

### 展示（自动对比度 + 手动增益，用户已确认）

新纯函数模块 `src/components/editor/waveformDisplay.ts`（可单测）：

- `buildWaveformTransform(peaks)`：一次性计算 `floor = percentile(非零桶, 0.20)`、`ceil = percentile(全桶, 0.995)`（防单尖峰拉低整体），返回映射 `v → clamp((v - floor) / max(ceil - floor, ε), 0, 1)`。BGM 恒定时底噪被压到 ≈0、语音增量占满高度；普通素材 floor≈0 时映射近似恒等，自动免疫。
- `aggregatePixelPeak(peaks, startMs, endMs, samplesPerMs)`：像素列取桶区间 **max**（替换现单桶采样 `Timeline.tsx:800`），消除缩小时的跳桶混叠；放大到桶宽以上仍为台阶（10ms 粒度下可接受，不做插值）。
- 手动增益：`min(1, mapped * gain)`，`gain ∈ [0.25, 8]`、默认 1、Shift+滚轮每格 ×1.25（波形区 canvas 上）。Timeline 组件 state，会话级、不持久化（与 VAD 会话约定对齐）。gain ≠ 1 时在波形区右上角画 `×N.N` 小标签；底部提示文案更新为「波形区滚轮平移 · Shift+滚轮波形增益 · Ctrl+滚轮缩放」。

权衡：显示映射后波形高度不再反映绝对响度（仅显示层变换，提取数据不变）；自动估底在 BGM 音量大幅起伏的素材上可能偏差，Shift+滚轮即兜底。

## R3 播放当前行按钮

- `useEditorHotkeys.ts:93-106` 的 `playSegment` 闭包原样提取为 `src/services/playbackActions.ts` 的 `playSelectedCueSegment()`（getState 读双 store，行为零改动；R2 落地后其中 `setCurrentTime(cue.startMs)` 随全局清点改 `requestSeek`）。hotkey `"play-segment"` 与新按钮共同调用。
- `PlaybackControls` 播放按钮右侧新增 shadcn `Button variant="ghost"`：订阅 `selectedCueId`，无选中行时 `disabled`；`title={formatActionShortcutTitle("播放当前行", "play-segment", hotkeys)}`；图标为内联 SVG（lucide 风格 `stroke="currentColor"`）：左右短竖线夹一个播放三角（段界+播放隐喻），与现按钮 `h-5 w-5` 一致。
- 不改 `hotkeys.ts:82` 的映射、scope 与描述文案。

## 兼容性与迁移

- 无持久化格式、无 Tauri command 签名、无 ASS 数据面改动；全部为前端运行时行为 + Rust 输出精度（3 位小数，消费方仅前端绘制，无兼容问题）。
- `playbackStore` 新增字段均为可选运行时状态，不涉及项目文件。

## 验证与回滚

- 单测：`waveformDisplay`（percentile/transform/aggregate 边界）、`activeCueTracker`（边界写入频率、重叠 cue）、`playbackActions`（迁移现 hotkeys 段播用例）、PlaybackControls 按钮（渲染/禁用/点击）、Timeline/SubtitleList/VideoPlayer 现有用例适配。
- 性能验证：React Profiler 确认播放期间 `SubtitleList`/`Timeline` 零按帧渲染；`tauri dev` 与打包版各人工验证一次（1000+ 行文档 + 恒定 BGM 素材）。
- 回滚：三个子项各自独立成组提交（由用户决定提交时机），任一项可单独 revert；R2 内部 store 先行、组件顺次接入，每步可编译可测。
