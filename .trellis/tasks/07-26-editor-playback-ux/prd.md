# Editor playback UX: waveform visibility, playhead smoothness, play-current-line

## Goal

字幕编辑页实际使用中发现的三项播放体验问题，统一在本任务跟踪：

1. 恒定音量 BGM 场景下波形起伏过小，无法依靠波形分辨语句起止。
2. 播放头移动有延迟、更新呈一格一格跳动，点击停止后播放头停下也有延迟，不跟手。
3. 播放按钮右侧补一个「播放当前行」按钮，复用现有 R（`play-segment`）逻辑，**不改动该逻辑本身**（用户已确认缩减范围）。

## 背景与已确认事实（2026-07-26 dev 分支代码排查）

### 波形（R1）

- 提取：`src-tauri/src/ffmpeg.rs` `run_extract_waveform`（`ffmpeg.rs:353`）解码整段音频为 16kHz mono s16le，按桶取 `max(|i16|)/32768` 绝对满刻度归一化。
- 前端固定请求 `samples = 4000`（`Timeline.tsx:131`），与视频时长无关：30 分钟视频一个桶 ≈ 450ms，本身就低于语句边界所需分辨率；恒定 BGM 又把每个桶的峰值抬到接近同一水平，语音叠加的相对增量被视觉压扁。
- 绘制：`Timeline.tsx` `drawFixedLayer`（`Timeline.tsx:792-822`）按屏幕像素采样 `idx = floor(ms * samplesPerMs)` 取单桶画上下包络折线——缩小时跳桶（混叠丢峰），放大时多像素重复同桶（台阶状）。

### 播放头（R2）— 病因诊断

`VideoPlayer.tsx:309-344` 已有播放期 rAF 每帧 `setCurrentTime`（60Hz 写 zustand store），机制本身正确；卡顿来自**每帧写入触发的 React 订阅者过重**，主线程饱和后掉帧，输入事件（暂停点击）排队 → 不跟手。逐项确认的每帧成本：

- `Timeline.tsx:121` 订阅裸 `currentTimeMs` → 每帧整组件重渲染 + 重绘效应全量执行：`prepareCanvas`（`Timeline.tsx:727-742`）每次重设 `canvas.width`（双 canvas 重分配+清空）、`getBoundingClientRect` 强制布局、`resolveTimelineColors`（`timelineColors.ts:46`，`getComputedStyle` 强制样式重算）、`assignCueLanes(cues)` O(n)、波形折线 2×宽度点、全部可见 cue 矩形+文字。
- `SubtitleList.tsx:98` 订阅裸 `currentTimeMs` → 每帧整表重渲染（无虚拟化，逐行 `isCueActiveAtTime`，`SubtitleList.tsx:319`），行数多时是最大单项开销。
- `VideoPlayer.tsx:33` 订阅裸 `currentTimeMs` → 自身每帧重渲染；外部 seek 效应 `VideoPlayer.tsx:349-407` 依赖 `currentTimeMs`，每帧重执行（listener 挂卸+死区计算）。
- `PlaybackControls.tsx:25`、`SubtitlePreview`（经 `VideoPlayer.tsx:453` prop）每帧重渲染（量级小）。
- 自动滚动 `revealTimelineTime`（`timelineModel.ts:30-41`）是翻页式（播放头出视区才居中重定位），非连续滚动——静态层重绘频率需求本来就低。

### 播放当前行（R3）

- 既有实现保持不变：`hotkeys.ts:82`（R，`play-segment`，outside-input）→ `useEditorHotkeys.ts:93-106` `playSegment`（段播中再按 R = 暂停中断；否则 seek 到选中行 `startMs`、`setPlayUntil(endMs)`、播放）→ `playbackStore.playUntilMs` + `VideoPlayer` rAF 到点精确停在 `endMs`。
- 暂停任意路径统一清除 `playUntilMs`（`playbackStore.ts:33-35`），空格/Ctrl+P/播放按钮已天然回到正常连续播放。
- 控制条 `PlaybackControls.tsx` 目前只有 后退5s/播放暂停/前进5s + 时间 + 进度条 + 撤销重做；`playSegment` 是 `useEditorHotkeys` 内部闭包，未导出供按钮复用。

## Requirements

### R1 波形可辨识度

- 在存在恒定音量 BGM 的音频上，波形必须能视觉区分「有人声语句」与「仅 BGM」区段，可据此判断语句大致起止。
- 波形时间分辨率与视频时长解耦，缩放到语句级别时不呈粗粒度台阶；缩小时不因跳桶丢失短促语音峰。
- 对安静/正常素材不劣化现有观感（不整体削顶、不把噪声底放大到与语音混淆）。
- 方案（用户 2026-07-26 已确认）：**自动噪声底扣除为默认** + **Shift+滚轮手动纵向增益兜底**；增益仅当前会话有效，不写入设置。细节见 design.md。

### R2 播放头平滑与跟手

- 播放期间播放头随视频帧连续平滑移动，肉眼不可见逐格跳动（参照：与视频帧率一致或 60fps）。
- 点击暂停/按空格后播放头立即停住，无可感知滞后。
- 消除每帧 React 全量重渲染：播放中 `SubtitleList`、`Timeline` 组件不得按帧重渲染；canvas 静态层（波形/刻度/字幕矩形）不得按帧全量重绘。
- 不回退既有行为：R 段播到点精确停在 `cue.endMs`、暂停后 cue 高亮保持、外部 seek 死区与越界防护、`playUntilMs` 语义。
- 播放中「取当前播放时间」的动作（帧步进、设为行起止、新建字幕于播放头等 `getState().currentTimeMs` 消费点）取值精度不劣于现状。

### R3 播放当前行按钮

- `PlaybackControls` 播放按钮右侧新增「播放当前行」按钮（shadcn Button + SVG 图标，遵循 NavIcons/lucide 约定，禁 emoji）。
- 点击行为与按 R 完全一致（复用同一实现；将 `playSegment` 提取为可共享动作，hotkey 与按钮共同调用）。
- tooltip 用 `formatActionShortcutTitle` 带出 R 快捷键提示；无选中行时保持现有 no-op 语义（按钮可置 disabled）。
- **不修改** `play-segment` 的触发逻辑、描述文案与快捷键。

## Acceptance Criteria

- [ ] R1：带恒定 BGM 的实际素材上能凭波形分辨语句起止；缩放到 ±数百 ms 级别时波形不呈 450ms 台阶；普通素材观感无回退。`cargo test --manifest-path src-tauri/Cargo.toml` 通过（波形提取相关用例更新）。
- [ ] R2：播放中播放头平滑移动、暂停即时停住；React Profiler（或等效手段）验证播放期间 `SubtitleList` / `Timeline` 无按帧重渲染；既有行为回归项（段播精确停点、暂停高亮、seek 防护）通过现有测试。
- [ ] R3：播放按钮右侧出现「播放当前行」按钮，点击与按 R 行为一致（含段播中再点=中断）；无选中行时 disabled/no-op；tooltip 显示 R 快捷键。
- [ ] `pnpm test` 全量通过；涉及 Timeline / SubtitleList / VideoPlayer / PlaybackControls / hotkeys 的用例按需更新或新增。
- [ ] 在 `tauri dev` 与打包版各做一次人工验证（R2 症状环境覆盖）。

## Out of Scope

- 不改 R / `play-segment` 行为、描述与快捷键映射（用户 2026-07-26 明确缩减）。
- 不引入频谱图（spectrogram）模式。
- 不做 SubtitleList 虚拟化（除非 R2 验证发现边界频率重渲染仍不达标，另立任务）。