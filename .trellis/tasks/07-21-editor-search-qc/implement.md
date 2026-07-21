# 实施计划：编辑页字幕查找替换、筛选与质检

## 前置确认

- [x] 0. 阅读 `.trellis/spec/frontend/` 相关规范与 AGENTS.md（shadcn 组件、中文文案、SVG 图标、`@/` import 约定）。
- [x] 0.1 确认 `hotkeys.ts` 无 `ctrl+f` 占用；确认 SubtitleList 选中行是否已有滚动可见逻辑（无则在 panel 定位处补最小滚动）。

## 步骤

- [x] 1. `src/utils/subtitleSearch.ts`：`SubtitleFilters`、`matchesFilters`、`collectMatches`、`findAdjacentMatch`、`applyReplace` / `replaceInCues`。配套 `subtitleSearch.test.ts`。
- [x] 2. `src/utils/subtitleQc.ts`：`QcRule`、`QcIssue`、`runQcChecks`（空文本 / end<=start / 超时长 / 重叠 / 高 CPS / 单行过长或换行过多 / 未知样式）。配套 `subtitleQc.test.ts`。
- [x] 3. `src/components/editor/SubtitleFindPanel.tsx`：查找替换 + 筛选 UI；替换当前 `updateCue`；全部替换一次 `replaceCues`；命中定位同步更新 playbackStore 选中行与播放头。
- [x] 4. 质检 Tab：`useMemo(runQcChecks)`，issue 列表点击定位；无问题空态；仅警告。
- [x] 5. 接线：`EditorView.tsx` 右列列表上方挂面板；`hotkeys.ts` + `useEditorHotkeys.ts` 注册 `ctrl+f`。
- [x] 6. 验证：`pnpm test` → `pnpm build`。

## 反馈迭代（2026-07-21）

- [x] 7. 文档已同步：去掉「间隔过近」；面板窄列可读；列表 Aegisub 式重叠高亮（见 prd R3.4 / R4.4 / R5）。
- [x] 8. `subtitleQc.ts`：删除 `GAP_MIN_MS` / `tight-gap`；导出 `cuesOverlap` + `collectOverlappingCueIds`；更新 `subtitleQc.test.ts`。
- [x] 9. `SubtitleFindPanel.tsx`：窄列整体纵向组织；查找/替换、时间起/止和成组按钮各用一行两列；样式全宽、空文本独占一行；去掉 tight-gap 文案分支。
- [x] 10. `SubtitleList.tsx`：对活动 `selectedCueId` 计算重叠 id 集合，非选中重叠行整行 `danger` 高亮（选中样式优先）。
- [x] 11. 验证：`pnpm test -- subtitleQc subtitleSearch` → 全量 `pnpm test` → `pnpm build`。
- [x] 12. ~~右栏改宽（误判，已回滚）~~ → 真因：Tabs 横排。修 `tabs.tsx` 用 `data-[orientation=horizontal]:flex-col`；FindPanel 补 `flex-col`。
- [x] 13. `subtitleQc.ts`：重叠质检从相邻比较改为 max-end 扫描，覆盖嵌套/非相邻重叠；补对应测试。
- [x] 14. `SubtitleFindPanel.tsx`：展开态改为单头栏悬浮卡片，不压缩列表；整卡 `max-h-[min(60vh,480px)]`、内部滚动、`bg-popover/80`、四周阴影、右侧加宽间距与 `ring-foreground/10`。
- [x] 15. 交互收尾：点击头栏与 Ctrl+F 统一打开并聚焦查找框；Esc 关闭且不回焦头栏；查找/质检定位同步移动播放头。
- [x] 16. Ponytail 精简：删除无收益 callbacks、单项批量替换、重复头栏 DOM、恒定 severity 与冗余 helper；生产代码净减 74 行。
- [x] 17. 组件规范：头栏和质检问题项的原生 button 改为 shadcn `Button`；同步 PRD/design/implement。
- [x] 18. 最终验证：`pnpm test`、`pnpm build`、`git diff --check`。

## Spec 更新决策

- 无需修改 `.trellis/spec/`：本任务没有新增跨层/API 合约；批量 cue 修改走单次 `replaceCues`、业务控件使用 shadcn、筛选输入保持瞬态等可复用约束已由 frontend spec 覆盖。悬浮卡片尺寸、透明度与焦点行为属于本功能设计细节，保留在 `design.md`。

## 回滚

- 删除新增的 `SubtitleFindPanel.tsx`、`subtitleSearch.ts` / 测试、`subtitleQc.ts` / 测试；还原 `EditorView.tsx`、`SubtitleList.tsx`、`hotkeys.ts` / 测试、`useEditorHotkeys.ts` / 测试及 `components/ui/tabs.tsx`。

## 检查点

- 质检单测覆盖无 tight-gap、端点不重叠、嵌套/非相邻重叠、阈值与未知样式。
- 手工 smoke：点击头栏和 Ctrl+F 均聚焦查找框；Esc 无头栏 focus 环；定位同步移动播放头；浮层不压缩列表且超高内容内部滚动；全部替换可单次撤销；活动行的重叠行正确高亮。
