# 实施计划：翻译失败可见、重试与取消

## 1. 扩展翻译取消与结果契约

- 在 `src/services/translation/types.ts` 为 `TranslationOptions` 增加可选 `signal`，为 `TranslationResult` 增加 `cancelled`。
- 更新 `TranslationProvider.generateText` 抽象签名及 OpenAI/Gemini/Anthropic 实现，把 signal 传入 generation HTTP 请求；`listModels` 保持不变。
- 在 `src/services/translation/http.ts` 组合 caller signal 与 timeout signal；generation HTTP 错误先精确打码全部已知敏感值，再分别以 credential/Authorization 4+ 字符、request content/字幕/术语表/prompt 8+ 字符残余重叠阈值决定是否丢弃结构化服务端原因；非 JSON body 丢弃。

验证点：timeout 仍是普通失败；只有 caller signal 触发用户取消语义。

## 2. 让 scheduler 可取消排队请求

- 为 `RequestScheduler.schedule` 增加可选 `AbortSignal`。
- 调整 drain/timer 时机，使 RPM timer 等待中的请求仍可从 queue 删除。
- abort 后立即 reject 未启动 promise，保证其 `run` 永不调用；已启动请求由同一 signal 在 HTTP 层终止。
- 保留现有 FIFO、maxConcurrency、RPM 间隔与 delayed timer 行为。

回滚点：scheduler diff 独立于 provider/result 聚合；先确保现有三个调度测试仍通过。

## 3. 保留取消前的批次与 fallback 结果

- 在 `src/services/translation/base.ts` 让 schedule/generate 全链路接收 signal。
- 区分主动取消、批量索引 JSON、确定性错误与瞬时错误：同一批次的格式校验按顺序重试，第二次仍失败才进入 fallback；确定性错误立即停止；批次和 fallback 单条遇到 `408/409/425/429/5xx`、超时或网络异常时优先重试 1 次，第二次仍失败才计为一个失败工作单元。共享失败 streak 按工作单元完成顺序更新，两个重试耗尽的失败完成且其间没有成功完成时停止，任何成功完成都会清零 streak。
- 让 batch/fallback 主动取消路径返回正常 `BatchResult`，保留已成功 cue，不因 `Promise.all` reject 丢失结果。
- 聚合 `cancelled`、成功数、失败数和 source order；取消项不制造重复错误或虚假 100% progress。
- 在共享 generation 边界把任意异常归类为受控类别/HTTP 状态；对结构化服务端原因精确打码已知敏感值，并在残余 credential/Authorization 4+ 字符或 request content/字幕/术语表/prompt 8+ 字符重叠时丢弃原因；始终丢弃非 JSON response 和任意异常文本。

验证点：invalid JSON fallback、供应商级错误快速停止、取消和 source order 测试不回归。

## 4. 重构 TranslateView 的结果与保存边界

- 用一个 translation result 状态替代单一 `success` boolean，并持有当前 controller/run token。
- 将 glossary/options 构造保持在页面内，完整翻译与失败重试复用同一 run 函数。
- 添加按 cue `id` 合并 retry result 的最小纯 helper；只重试无有效 `secondaryText` 的 cue，保留旧成功译文和顺序。
- 抽出页面内 apply/save helper，复用现有 ASS logical→physical、recovery discard、document guard 和 save token 配对。
- 完整成功继续自动 apply/save；部分失败和取消只保留页面 draft，显式保存时重新确认丢弃未保存字幕。
- 将取消入口限定在 provider 请求阶段；同步记录 cancel request，确保其与最后 HTTP response 竞态时仍不会进入自动 apply/save。
- session 切换和 unmount abort 当前运行，把“不会在后台继续运行”的取消消息保留到 taskStore；页面内手动取消继续使用简洁计数消息。

回滚点：现有完整成功自动保存流程必须在 UI 改动前由测试锁定。

## 5. 增加状态、重试、保存与错误 UI

- 运行中增加 shadcn “取消翻译”按钮。
- 完整成功、部分失败、零成功失败、取消、fatal error 分别展示准确中文状态与成功/失败计数。
- 部分/取消状态增加“重试失败条目”和“保存当前结果”；无成功译文时不允许保存。
- 用原生 `<details>` 展开最多 20 条安全错误摘要，并提示剩余数量。
- “进入编辑”只在结果已应用到 project store 后开放；页面内 draft 不冒充已保存结果。
- 更新 taskStore status/message，避免零成功显示部分完成、部分失败标记为 success、取消后残留 running；只有切页或切换视频导致的取消须在状态栏和重新进入翻译页后明确说明不会在后台继续，手动取消可显示简洁计数。
- 翻译页根容器使用 `min-h-0 flex-1 overflow-y-auto overflow-x-hidden`，使新增状态区可滚动。

## 6. 聚焦自动化验证

在 `src/services/translation/translationProviders.test.ts` 增加：

- pre-aborted、queued、timer-waiting scheduler 请求不会启动，priority 重试先于尚未启动的普通请求；
- in-flight fetch 接收组合 signal 并被用户取消；
- 主动取消不触发 fallback；
- fallback 途中取消保留已成功 singles；
- 已完成 batches 在取消结果中按 source order 保留；
- 确定性错误不重试并立即停止；批次与 fallback 单条的瞬时错误第二次尝试可成功，共享 streak 按完成顺序在重试耗尽失败时递增、在成功完成时清零，两个失败完成且其间无成功完成时停止；同批次格式校验仍顺序重试两次后才 fallback；
- 安全结构化服务端原因可见，已知敏感值精确打码，credential/Authorization 4+ 字符或 request content/字幕/术语表/prompt 8+ 字符残余重叠会抑制原因，非 JSON body 与任意异常文本不可见；
- 取消与最后 HTTP response 竞态时不自动 apply/save。

保留现有页面纯逻辑测试与 `translatePhysicalBoundary.test.ts` 契约；此前延后的 `TranslateView` 组件测试不在本任务中新增。仅在需要覆盖不完整 cue 序列化时添加一个聚焦边界 case。

## 7. 质量门禁

按顺序运行：

```bash
pnpm test -- src/services/translation/translationProviders.test.ts
pnpm build
```

最终检查：

- 只改 frontend translation/UI 与本 task/spec（若 Phase 3.3 确认需要）文件；
- 无新依赖、Tauri command、设置字段或全局翻译 store；
- 无 API Key、prompt、请求正文或字幕原文进入 UI、console、测试快照；
- `subtitleMergeMode` 仍只在 translation generation 保存边界生效；
- 完整成功自动保存，部分失败/取消必须显式保存。
