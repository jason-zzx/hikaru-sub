# 实施计划：最近工作视频与首页续接

按序执行；每步后运行对应验证。

## 1. 最近列表服务

- [x] 新增 `src/services/recentVideos.ts` + `recentVideos.test.ts`
- [x] 验证：`pnpm test -- recentVideos`

## 2. 共享打开流程提取

- [x] 新增 `src/services/openVideo.ts`：`openVideoSession`（提取自 `ImportView.handleSelectVideo`）、`importExternalSubtitle`（提取自 `EditorView.handleSelectSubtitleFile` 核心）
- [x] `ImportView.tsx` 改为调用 `openVideoSession`，行为不变
- [x] `EditorView.tsx` 改为调用 `importExternalSubtitle`，行为不变
- [x] 迁移/补充测试（ImportView 若有现有测试需同步更新）
- [x] 验证：`pnpm test`（全量，确认重构无回归）

## 3. WelcomeView

- [x] "继续当前工作"卡片（session 存在时，按钮按 pathExists 门控）
- [x] "最近打开"列表（徽标、相对时间、移除、点击打开并跳转）
- [x] 新增 `WelcomeView.test.tsx` 覆盖：列表渲染、点击打开、续接按钮门控
- [x] 验证：`pnpm test -- WelcomeView`

## 4. 全局拖放

- [x] 从 `tauri.ts` 导出视频扩展名列表（或提取到共享常量）
- [x] 新增 `src/hooks/useGlobalFileDrop.ts`，在 `AppLayout` 挂载
- [x] 验证：`pnpm test`（hook 分类逻辑单测）+ `pnpm build`

## 5. 审查修复

- [x] 修复 StrictMode 下异步拖放监听清理竞态，并忽略卸载后的旧回调
- [x] 用 `hasSubtitleDocument` 修复恢复快照后的导航判断
- [x] 用 document guard 阻止确认后过期的打开结果覆盖新编辑或新会话，包括恢复确认期间的同会话编辑
- [x] 磁盘字幕未载入时，继续编辑先复用打开流程
- [x] 拖放字幕后选中并 seek 第一条 cue
- [x] 补充 `openVideo`、拖放 hook、WelcomeView 行为测试
- [x] 精简共享结果契约：删除无人消费的 `loadedKind` / `cueCount`
- [x] 将恢复 document guard 收回 `restoreSubtitleRecovery` 内部
- [x] 内联单调用拖放路径选择并删除重复源码字符串断言

## 6. 收尾

- [x] `pnpm test` 全量 + `pnpm build`
- [x] 汇报改动，询问是否提交（不主动 commit）

## 回滚点

步骤 2 完成时是一个稳定中间态（纯重构）；3、4 相互独立，可单独回退。
