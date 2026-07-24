# 时间轴打轴增强实施计划

> 状态：实现和自动化验证已完成。真实 Tauri WebView 下的主题、缩放、多泳道和指针手感人工检查仍待执行，见第 5 节唯一未勾选项。

## 1. 纯时间变换与吸附计算

- [x] 在 `src/services/editorActions.ts` 增加平移目标类型、按帧数换算、批量时间平移、整条 cue 有界移动和吸附解析函数。
- [x] 保持未选择/未变化 cue 的引用；不修改 `projectStore` API。
- [x] 保留现有边界拖动交换语义；新数值单侧平移使用截断到另一侧的独立规则。
- [x] 在 `src/services/editorActions.test.ts` 覆盖时间/帧数换算、提前归零、延后越过视频结尾、单侧零时长、批量完整 delta、主体范围限制、候选优先级、双边界最小位移和 30 FPS 回退。

验证：

```bash
pnpm test -- src/services/editorActions.test.ts
```

回退点：纯函数和测试必须先稳定；若需求边界不能由无状态变换表达，返回规划修订，不向 Store 增加模式状态。

## 2. 平移时间轴对话框与菜单接线

- [x] 新增 `src/components/editor/ShiftTimesDialog.tsx`，复用 shadcn `Dialog`、`RadioGroup`、`Input`、`Label`、`Button` 和现有时间输入工具。
- [x] 在 `SubtitleList` 现有右键菜单增加“平移时间轴”，把菜单选择快照传给父级，不重写菜单组件；右键命中未选行时先调用父级草稿提交回调，再切换活动行。
- [x] 在 `EditorView` 拥有对话框状态；打开只保存菜单选择快照，确认时提交当前时间草稿、读取最新 cues 并只调用一次 `replaceCues`。
- [x] 为对话框输入模式、无效/零值禁用、FPS 回退和确认参数增加聚焦组件测试。
- [x] 为右键命中已选/未选行时传出的 ID 快照增加聚焦测试；覆盖 cue A 有草稿、右键未选 cue B 后 A 草稿仍存在，以及取消对话框不额外提交草稿。避免把整份 JSX 固化为 source guard。

验证：

```bash
pnpm test -- src/components/editor/ShiftTimesDialog.test.tsx
pnpm test -- src/components/editor/SubtitleList.test.tsx
pnpm test -- tests/EditorViewBehavior.test.ts
```

回退点：对话框保持受控且无 Store 所有权；若接线开始复制 cue 状态，回退到 `EditorView` 单一协调点。

## 3. Timeline 主体拖动与共享吸附

- [x] 将 `Timeline` lane 拖动状态扩展为边界/主体两类；主体使用 4px 阈值、pointer-down 抓取时间、单选收敛和持续时间保持，并在 pending/active 主体手势期间抑制选择触发的 auto-reveal。
- [x] 为边界与主体拖动接入共享吸附解析，排除当前 cue 自身边界，按手势快照固定播放头/FPS/其他边界，并绘制瞬态垂直吸附指示线。
- [x] 在指针开始改变选择或时间前调用父级时间草稿提交回调，并从 Store 重新读取最新 cue；不得继续使用提交前的 canvas rect cue。
- [x] 对持续时间大于视频的 cue 保持主体拖动 no-op；对仍可容纳但部分越界的 cue 拉回合法范围，不缩短持续时间。
- [x] 加入幂等 `lostpointercapture`/`pointercancel`/卸载清理，先清活动手势再释放 capture，确保取消和主动 release 都不会二次提交。
- [x] 保持空白 lane 点击定位、缩放、多泳道、自动 reveal 和现有边界交换行为。

## 4. 波形区间框选

- [x] 为固定 canvas 增加波形区域主指针手势：4px 横向阈值区分点击与框选；标尺、两处间隙和无活动 cue 情况保持点击定位。
- [x] 框选开始时提交时间草稿并把多选收敛为活动 cue 单选；锚点和当前点分别吸附并显示范围预览。
- [x] pointer up 只调用一次 `updateCue`；无选中、普通点击、取消和 lost capture 不修改文档。
- [x] 增加 `Timeline.test.tsx`，最小 mock Tauri `invoke`、canvas context/尺寸、`getBoundingClientRect` 和 pointer-capture；验证主体持续时间、auto-reveal 稳定、单次提交、取消/lost capture、边界吸附、波形点击与拖动区分、选择收敛和无选中不修改。
- [x] 仅在几何模型确实变化时修改 `timelineModel.ts` / `timelineModel.test.ts`。

验证：

```bash
pnpm test -- src/components/editor/Timeline.test.tsx
pnpm test -- src/components/editor/timelineModel.test.ts
```

回退点：canvas 只保留手势路由和绘制；任何可纯化的时间计算移回 `editorActions`，避免在组件和测试中维护两套规则。

## 5. 全量质量检查

- [x] 对照 `prd.md` 逐项验证右键平移、主体拖动、三类吸附和波形框选。
- [x] 检查一次手势/一次确认只产生一个对应历史命令，时间草稿不会被覆盖，no-op 不产生历史；覆盖无草稿时批量平移新增一条历史，以及有草稿时先草稿后平移形成两条可分别撤销的历史。
- [ ] 在真实 Tauri WebView 中人工检查浅色/深色吸附指示线、不同缩放、多泳道和指针手感；零时长 cue、视频首尾和 30 FPS 回退已有自动化覆盖。
- [x] 检查无新依赖、无后端/ASS/Store 契约改动、无无关重构。

最终验证：

```bash
pnpm test
pnpm build
```

本任务只涉及前端，不需要运行 Rust 或 Python 测试。
