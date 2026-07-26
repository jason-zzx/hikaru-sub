# Implement — editor-playback-ux

三个阶段相互独立、各自可验证、可单独回滚（提交时机由用户决定，AI 不主动提交）。阶段内步骤保持每步可编译可测。

## Phase A — R3 播放当前行按钮（最小，先行）

- [x] A1 新建 `src/services/playbackActions.ts`：`playSelectedCueSegment()`，逻辑自 `useEditorHotkeys.ts:93-106` 原样迁移（getState 读 playback/project 双 store，行为零改动）；`useEditorHotkeys` 的 `"play-segment"` 改为调用它。迁移/适配现有段播相关用例。
- [x] A2 `PlaybackControls.tsx`：播放按钮右侧新增 ghost Button——订阅 `selectedCueId`，无选中行 `disabled`；`title={formatActionShortcutTitle("播放当前行", "play-segment", hotkeys)}`；内联 SVG 图标（lucide 风格：左右短竖线夹播放三角，`h-5 w-5`）。不改 `hotkeys.ts` 任何映射与文案。
- [x] A3 新增 PlaybackControls 测试：按钮渲染、无选中禁用、点击调用 `playSelectedCueSegment`。
- 验证：`pnpm test -- PlaybackControls`、涉及 hotkeys 的相关测试文件、`pnpm build`。

## Phase B — R2 播放头平滑（主诉）

- [x] B1 `playbackStore`：新增 `activeCueIds: string[]`、`seekRequest: {ms, seq} | null`、`requestSeek(ms)`（同步写 `currentTimeMs`）。store 单测。
- [x] B2 新建 `src/services/activeCueTracker.ts`（模块单例，App 挂载初始化）：vanilla `subscribe` 监听 `currentTimeMs` 与 `projectStore.cues`，命中集合（含重叠 cue）变化时才写 `activeCueIds`。单测：边界写入频率（同一 cue 内多次 tick 不触发写入）、重叠命中、seek 跳变。
- [x] B3 seek 意图清点：所有用户意图跳转改 `requestSeek` —— `PlaybackControls`（进度条/±5s）、`Timeline`（波形区点击/拖拽、手势落点）、`SubtitleList`（`applyCueListResult`、行激活）、`useEditorHotkeys`（帧步进、边界跳转）、`playbackActions.playSelectedCueSegment`（行首）、编辑页进入选首条、时间输入提交路径。播放回写（rAF/timeupdate/暂停收尾/段播终点 snap）保持 `setCurrentTime`。以 `grep setCurrentTime(` 全量清点为准，逐处判定意图。
- [x] B4 `VideoPlayer`：删除 `:33` 渲染订阅（`handleVideoError` 改 getState）；外部 seek 效应依赖改 `[seekRequest, videoSrc]`（死区/越界/HAVE_METADATA 逻辑不动）；`SubtitlePreview` 时间 prop 改哨兵选择器（播放中 `null` 保持上次值，暂停/seek 给精确值），CSS 兜底句切换靠 `activeCueIds`。回归 libass 暂停定帧与 CSS 兜底。
- [x] B5 `Timeline`：播放头剥离为绝对定位 2px div（`pointer-events-none`），瞬态 `subscribe` 写 `translateX` + `revealTimelineTime` 翻页判定（容器宽 ResizeObserver 缓存）；重绘依赖移除 `currentTimeMs`、加入 `activeCueIds`（lane `cuePlaying` 改 id 判定）；手势快照 `playheadMs` 改 getState；`prepareCanvas` 尺寸未变不重设 canvas；`resolveTimelineColors` 按 `themeVersion` memo。
- [x] B6 `SubtitleList`：订阅改 `activeCueIds`；`:319`/`:282-283` 改 id 比较；动作内即时时间改 getState。
- [x] B7 适配 Timeline / SubtitleList / VideoPlayer 现有测试；跑全量 `pnpm test`、`pnpm build`。
- [ ] B8 性能与回归人工验证（`tauri dev` + 打包版各一次，1000+ 行文档 + 恒定 BGM 素材）：React Profiler 播放期间 `SubtitleList`/`Timeline` 零按帧渲染；播放头平滑；暂停即停；回归清单——段播精确停 `cue.endMs`、暂停清 `playUntilMs`、暂停后高亮保持、seek 死区/越界防护、暂停帧步进放行。
- 风险点：B3 清点漏改会表现为「点击跳转不生效」（video 不再吃 currentTimeMs echo）；B4/B5 是行为敏感区，出现回归优先回退单步而非叠补丁。

## Phase C — R1 波形可辨识度

- [x] C1 新建 `src/components/editor/waveformDisplay.ts` 纯函数模块 + 单测：`percentile`、`buildWaveformTransform`（floor=非零 p20，ceil=p99.5，ε 防护）、`aggregatePixelPeak`（像素列桶区间 max）、增益应用 `min(1, v*gain)`。
- [x] C2 `Timeline`：`samples = clamp(ceil(durationMs/10), 4000, 720_000)`；`drawFixedLayer` 改用 aggregate+transform+gain；Shift+滚轮增益（×1.25/格，范围 0.25–8，会话级 state）；gain≠1 时波形区右上角 `×N.N` 标签；底部提示改「波形区滚轮平移 · Shift+滚轮波形增益 · Ctrl+滚轮缩放」。
- [x] C3 Rust `run_extract_waveform`：峰值圆整 3 位小数；适配/补充波形提取用例。
- 验证：`pnpm test -- waveformDisplay Timeline`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm build`；恒定 BGM 素材人工对照（能辨句起止、普通素材无回退）。

## 人工验证反馈修复（2026-07-26 第一轮）

- [x] F1 波形时间错位：`downsample_waveform_peaks` 整除截尾导致尾样本丢弃 + 前端均摊全时长 → 随时间线性放大的漂移（高采样数下 24 分钟可漂 ~9s）。改均匀边界分桶 `[i*len/samples, (i+1)*len/samples)`，新增尾样本保留与脉冲定位（±1 桶）防漂移回归测试。
- [x] F2 播放头进出字幕块卡顿：`activeCueIds` 边界突发提交过重。SubtitleList 行提取为 `React.memo` `SubtitleRow`（边界只重渲染进出的 1–2 行）+ `knownStyleNames`/`columnVisibility` memo；Timeline 重绘拆 fixed/lane 两层 effect，边界只重绘 lane 层，波形逐像素聚合不再参与（拖拽预览同受益）。
- 验证：`cargo test` 181 通过、`pnpm test` 799 通过、`pnpm build` 通过。真机复验待用户。

## 人工验证反馈修复（2026-07-26 第二轮）

- [x] F3 波形仍偏（开头就偏、越往后越多、波形晚）：实测用户素材（HLS 合并 mp4）定位——AAC 流时间戳跨 4144.256s 但顺序解码仅得 4108.224s PCM（段间静音间隙被挤掉、零解码警告），前端均摊到容器时长产生线性漂移（片尾 ~36s）。修复：① 波形与 ASR 音轨解码均加 `-af aresample=async=1:first_pts=0` 按时间戳补静音（已在用户素材上验证输出精确 4144.256s）；② `extract_waveform` 返回 `WaveformData { peaks, coveredMs }`，前端映射改用 coveredMs，彻底摆脱对 `video.duration` 的依赖。ASR 同根因意味着此类素材旧转录时间戳片尾偏 ~36s——已提取过的 audio.wav 需「重新提取」后再转录。
- 验证：`cargo test` 184 通过、`pnpm test` 800 通过、`pnpm build` 通过。真机复验待用户。

## 外部代码审查修复（2026-07-27，7 条全部核实属实）

- [x] R1（高）连续 seek 死区早退遗留 `isSeekingRef=true` 冻结播放头 → seeked 改常驻监听（随 videoSrc 生命周期），videoSrc 变化/错误恢复路径复位门闩；新建 VideoPlayer.test.tsx 行为用例。
- [x] R2（中）resize 不重绘 → `containerWidth` state 入两层绘制依赖，RO 回调同步 ref+state。
- [x] R3（中）换片波形串片竞态 → stale 标记 + 进入 effect 先清空波形。
- [x] R4（中）稀疏短音被自动对比度抹掉（floor>ceil 塌缩）→ `ceil<=floor` 守卫回退 floor=0/ceil=max；恒定值用例语义随之翻转（恒定波形不再压零）。
- [x] R5（中）percentile 双排序 72 万桶主线程卡顿 → 1001 桶直方图 O(n)（峰值已量化 0.001，精确等价）。
- [x] R6（低）行首/行尾「分割」误启用 → 菜单打开时刻 getState 严格开区间快照。
- [x] R6 追加（中）：按钮状态用打开时刻快照、点击却用实时时间，菜单挂起期间播放继续会分裂 → `playheadMs` 存入 `ContextMenuState`，可用性判断与 `splitCueAtTime` 统一用快照；补「打开菜单后时间前进仍按快照分割」用例。
- [x] R7（低）Timeline 直连 invoke → `services/tauri.ts` 补 `extractWaveform` 封装，测试 mock service。
- 验证：`pnpm test` 808 通过、`pnpm build` 通过（无 Rust 改动）。

## 收尾

- [x] 全量 `pnpm test`（796 通过） + `pnpm build` + `cargo test`（179 通过）。
- [ ] 汇报改动与未运行验证项，**询问用户是否提交**（遵守 AGENTS.md 最高优先级规则，不主动 commit）。
