# 时间轴打轴增强技术设计

## Summary

本任务只扩展 React 编辑器层：在现有 `editorActions` 中增加纯时间变换与吸附计算，在 `Timeline` 中扩展指针手势，在字幕列表现有右键菜单中增加平移入口，并由 `EditorView` 统一协调平移对话框和右侧时间输入草稿。复用现有 `projectStore.updateCue` / `replaceCues` 历史契约，不新增 Store、第三方依赖、共享领域类型或 Tauri command。

## Boundaries

- `src/services/editorActions.ts`：保存可独立测试的时间平移、整条移动和吸附计算。
- `src/components/editor/Timeline.tsx`：保存 canvas 尺寸、指针捕获、拖动预览、光标和吸附指示线等交互状态。
- `src/components/editor/ShiftTimesDialog.tsx`：受控的平移参数表单；不直接读写项目 Store。
- `src/components/editor/SubtitleList.tsx`：只负责从现有右键菜单发出带选择快照的平移请求。
- `src/components/editor/EditorView.tsx`：拥有对话框状态，向列表/时间轴提供提交时间草稿的同步回调，并把一次批量结果交给 `replaceCues`。
- `projectStore`、`playbackStore`、`SubtitleCue`、ASS 和后端契约保持不变。

## Numeric Shift Contract

平移表单有三个互相独立的选择：

- 单位：时间 / 帧数。
- 方向：延后 / 提前。
- 目标：开始和结束 / 仅开始 / 仅结束。

时间量沿用 `src/utils/timeInput.ts` 的 `H:MM:SS.cc` 输入、解析和光标规则。帧数只接受非负整数，使用探测 FPS 计算一次总时间差；FPS 无效时沿用 30 FPS，最后统一四舍五入为整数毫秒。

纯变换接收 cue 列表、右键菜单快照的 ID、带符号毫秒差和目标字段，并保持未修改 cue 的对象引用：

- 延后不受视频时长限制。
- 提前得到负值的每个被调整字段独立归零，不缩减其他 cue 的位移量。
- 同时调整两侧时分别应用上述规则，因此靠近零点的 cue 可以缩短或变为零时长。
- 仅开始时间越过结束时间时令 `startMs = endMs`；仅结束时间越过开始时间时令 `endMs = startMs`。
- 无选择、零位移或结果无变化时返回引用不变的列表，由现有 Store 拒绝历史空操作。

右键命中未选行时，`SubtitleList` 必须先调用父级草稿提交回调，再切换活动行和建立菜单快照。点击菜单项只打开对话框，不额外提交草稿；确认时 `EditorView` 再提交当前活动行草稿、读取最新 cue 列表、执行一次纯变换并调用一次 `replaceCues`。因此取消对话框不会仅因打开命令而新增历史，同时旧活动行草稿不会在右键选择切换时丢失。

## Snap Contract

吸附使用两级 CSS 像素阈值，并在每次手势计算时乘以手势快照中的 `msPerPixel`：播放头/字幕边界为 12px 强吸附，视频帧为 4px 精细吸附。候选来源：

1. 手势开始时的播放头时间。
2. 除当前被编辑 cue 外，所有 cue 的开始/结束边界。
3. 当前 FPS 对应的最近帧起点；FPS 无效时按 30 FPS。

每个参与吸附的原始时间只需计算附近候选，不预生成全视频帧数组。帧起点定义为整数 `k >= 0` 的 `k * 1000 / effectiveFps`，只考虑视频范围内候选，并只在最终 cue 结果处四舍五入到整数毫秒。先在合法播放头/字幕边界候选中选择距离最近者，完全同距时播放头优先；只在没有强候选时才解析最近视频帧。主体开始/结束两个锚点同样先按强/帧层级选择，再比较修正距离，并以开始边界作为完全相同结果的最终 tie-break。命中吸附时在固定层和字幕层绘制同一条垂直指示线；没有命中则不显示。

每次手势在提交时间草稿后创建不可变吸附快照：手势开始前的播放头、有效 FPS，以及排除当前 cue 后的其他 cue 边界。拖动期间不读取可能异步变化的 FPS 或 cue 候选，避免吸附网格跳变。

- 边界拖动：被拖动边界参与吸附，之后沿用现有 `normalizeBoundaryDrag` 的交换和视频范围规则。
- 主体拖动：用抓取点相对原 cue 的时间差计算原始整体位移；持续时间大于视频时长时返回无变化，否则把 delta 限制在 `[-startMs, durationMs - endMs]`。这也会把仍可容纳但已经部分超出视频结尾的 cue 拉回最近合法位置。开始、结束边界都参与吸附，选择合法且绝对位移最小的结果，持续时间不变。
- 波形框选：锚点和当前点各自吸附，分别限制到视频范围，再按时间排序为开始/结束；允许零时长。

可变帧率逐帧映射、吸附设置和临时绕过键不在本任务内。

## Pointer Gesture Contract

所有新拖动只响应主指针左键，使用 pointer capture，并在 `pointercancel` 或意外失去 capture 时取消预览且不写历史。完成/取消函数必须幂等：先清除活动手势标记，再主动释放 capture，避免随后触发的 `lostpointercapture` 二次提交或误清理新手势；卸载时同样只清理瞬态状态。

### Subtitle Lane

现有 hit test 继续区分 `edge`、`body`、`empty`：

- `edge`：pointer down 时先提交旧活动行时间草稿，再从 `useProjectStore.getState()` 读取命中 ID 的最新 cue，然后切换选择并立即进入带吸附快照的边界拖动。
- `body`：pointer down 只记录命中 ID、抓取时间、原播放头和指针位置。超过 4 CSS 像素后提交草稿、重读最新 cue、收敛为单选并建立吸附快照；未超过阈值的 pointer up 也先提交草稿，再执行现有选中并跳到最新 cue 起点，不能依赖被 `preventDefault` 的 canvas 点击触发输入框 blur。
- `empty`：保留点击定位播放头，不创建或修改 cue。

选择变化触发的自动 reveal 在 pending/active 主体手势期间跳过，避免 `viewStartMs` 在手势分类或拖动中变化；抓取位移始终基于 pointer-down 时间和草稿提交后的 cue 快照，不依赖可能重排的矩形/泳道。拖动期间只更新组件预览。pointer up 使用最新预览调用一次 `updateCue`；取消手势不提交。

### Waveform Layer

只有从 `WAVE_TOP..WAVE_TOP + WAVE_HEIGHT` 内开始的主指针左键才可能成为框选手势：

- 无活动 cue 时保持点击定位播放头，不建立框选状态。
- 有活动 cue 时先记录按下位置和原播放头；横向移动未超过 4 CSS 像素仍视为点击。
- 超过阈值后提交时间草稿、重读活动 cue、把选择收敛为该 cue 单选、建立吸附快照并显示区间预览。
- pointer up 后一次 `updateCue`；普通点击则定位播放头。
- 标尺、标尺/波形间隙和底部间隙不启动框选，仍保持点击定位播放头。
- 对活动 cue 的 waveform pointer down 先捕获指针；取消或 lost capture 既不 seek 也不修改 cue。

延迟到阈值后再分类可同时保留点击定位，并让框选仍能吸附到手势开始前的播放头。

## UI Composition

`ShiftTimesDialog` 使用现有 shadcn `Dialog`、`RadioGroup`、`Input`、`Label` 和 `Button`。对话框显示所选行数，默认“时间 / 延后 / 开始和结束”，数值为零或输入无效时禁用确认。切换单位保留各自草稿，不引入额外持久状态。

现有字幕列表右键菜单只增加一个“平移时间轴”项并沿用菜单选择快照；不在本任务中改写整套菜单实现。平移对话框打开期间禁用全局编辑器快捷键，避免焦点位于 RadioGroup 等非文本控件时在模态框背后执行删除、打轴或撤销命令。

## History And Draft Safety

- 单 cue 边界、主体和波形手势：一次 `updateCue`。
- 多 cue 数值平移：一次 `replaceCues`。
- 预览、吸附指示线、对话框表单和指针状态不进入 Zustand。
- 时间草稿若有变化，先作为现有独立历史命令提交，再执行新操作；这避免静默覆盖，且不会把两个用户动作错误合并。右键或时间轴点击切换活动行前提交旧草稿，平移确认提交当前草稿。
- `runUndo` 在同一事件中提交真实时间草稿并执行 Store undo 后，显式从最终 Store 状态同步受控时间输入；否则 React 批处理可能省略中间 Store 值，让输入框继续显示已撤销草稿。
- pointer cancel、lost capture、无效或零变化操作不新增历史。

## Compatibility And Rollback

实现不迁移任何持久数据。每一阶段都可按文件回退：纯 helper、平移对话框接线、Timeline 手势彼此分层；若 canvas 组件测试暴露 jsdom 限制，仍须保留纯函数覆盖，并只添加最小 canvas mock，不把手势逻辑复制到测试专用模块。
