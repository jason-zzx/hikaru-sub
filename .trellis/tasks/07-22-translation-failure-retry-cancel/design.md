# 技术设计：翻译失败可见、重试与取消

## 1. 范围与边界

本任务是纯前端改动：

- `src/services/translation/` 负责取消信号、请求调度、HTTP abort、批次/回退的部分结果和安全错误摘要。
- `src/components/workflow/TranslateView.tsx` 负责单次运行生命周期、状态展示、失败条目重试、逻辑结果合并，以及完整/不完整结果的保存策略。
- 现有 ASS 逻辑 cue → `subtitleMergeMode` 序列化 → 物理 cue 边界保持不变。
- 不新增 Tauri command、Zustand 翻译 job store、设置字段、依赖或后台恢复能力。

翻译仍是页面级任务。离开页面或切换工作视频即取消当前运行，不尝试跨页面继续。

## 2. 服务契约

### 2.1 类型

扩展现有类型，不新增平行结果模型：

```ts
interface TranslationOptions {
  // existing fields
  signal?: AbortSignal;
}

interface TranslationResult {
  cues: SubtitleCue[];
  successCount: number;
  failedCount: number;
  errors: string[];
  cancelled: boolean;
}
```

`failedCount` 始终表示输入中没有成功译文的 cue 数；被取消且未完成的 cue 计入失败数，以便共用“重试失败条目”。`cancelled` 只表示用户/页面运行 signal 被主动 abort，不把超时当作用户取消。

三种 provider 的 `generateText` 增加 `signal?: AbortSignal` 参数。`listModels()` 保持原样，不接入翻译运行取消链路。

### 2.2 信号流

```text
TranslateView AbortController
  -> translateBatch(options.signal)
  -> RequestScheduler.schedule(run, signal)
  -> generateText(..., signal)
  -> fetchWithTimeout(..., init.signal)
```

`fetchWithTimeout` 使用原生 `AbortSignal.any([callerSignal, AbortSignal.timeout(timeout)])` 组合用户取消与现有超时。若没有 caller signal，继续只使用 timeout signal。

判定规则：

- `options.signal?.aborted === true`：主动取消，不进入/继续逐条 fallback。
- 确定性错误：HTTP `400/401/403/404/405/410/413/415/422` 或 provider response envelope 无效；不启动逐条 fallback，并立即终止其余排队和在途请求。
- 瞬时错误：HTTP `408/409/425/429/5xx`，以及由共享 `fetchWithTimeout` 明确包装的 timeout/network；同一工作单元原样重试 1 次，第二次仍失败才计为失败工作单元。共享 streak 按工作单元完成顺序更新：两个重试耗尽的失败工作单元完成且其间没有成功工作单元完成时终止其余请求，任何成功工作单元完成都会清零 streak。未知异常默认确定性，不重试且只展示受控通用文案。
- provider 响应 envelope 有效、但本地批量索引/translation JSON 校验失败：这不是共享瞬时失败 streak；同一批次按顺序执行原请求和一次优先重试，连续 2 次校验失败才逐条 fallback，因为单条纯文本响应不依赖批量索引 JSON 协议。

不要仅按异常名 `AbortError` 判断用户取消，因为超时同样通过 abort 实现。

generation 请求的错误展示使用受控分类：`请求超时`、`网络请求失败`、`API 错误 <status>`、`响应格式无效`。HTTP 结构化错误字段可附加到 `API 错误 <status>`，但须先精确打码所有已知 API credential/Authorization、request body、字幕、术语表和 custom/system/user prompt 值；打码后残余内容若与 credential/Authorization 有 4+ 字符重叠，或与请求内容/字幕/术语表/prompt 有 8+ 字符重叠，则丢弃原因。通过检查后再压平换行并限长；非 JSON body 丢弃。`listModels()` 继续使用现有 bounded provider message。

## 3. RequestScheduler 取消

`RequestScheduler.schedule` 增加可选 signal，不增加翻译专用 `cancelAll()`：

1. signal 已 abort 时立即 reject，`run` 不入队。
2. 入队后注册一次 abort listener；abort 时从 queue 删除该 request 并 reject。
3. RPM timer 等待期间 request 仍留在 queue，直到 timer 真正触发才 shift，保证等待中的工作也能被删除。
4. 请求启动前移除 scheduler listener；启动后由传给 provider/fetch 的同一 signal 终止在途请求。
5. 取消后继续 drain 其他未取消任务；若队列为空则清理无意义 timer。

并发槽只在真正启动请求时占用，`finally` 中释放。保留 FIFO、最大并发和基于真实启动时刻的 RPM 间隔。

## 4. 批次、fallback 与部分结果

### 4.1 BatchResult

内部 `BatchResult` 增加 `cancelled`：

- 批次成功：返回全部译文，`cancelled: false`。
- 本地批量索引/translation JSON 校验失败：第一次以调度优先级原样重试该批次；第二次仍校验失败才记录安全错误并启动逐条 fallback。
- 确定性错误：记录安全错误，通过内部 stop controller 立即终止排队和在途请求，不启动逐条 fallback；内部 stop 不设置 `cancelled`。
- 瞬时错误：通过共享 `runWithTransientRetry` 对同一工作单元原样重试 1 次；第二次仍失败才记录安全错误。共享失败 streak 按工作单元完成顺序更新：两个重试耗尽的失败完成且其间没有成功完成时内部停止，任何批次或 fallback 单条成功完成都会清零 streak。并发启动顺序不定义 streak 顺序。
- 批次请求因运行 signal 取消：返回该批原 cue，`successCount: 0`、`cancelled: true`，不记录每条取消错误。
- fallback 单条请求复用同一瞬时重试 helper：瞬时错误最多尝试 2 次，第二次仍失败才将该条计为失败；确定性错误和取消不重试。
- fallback 期间取消：保留取消前已经成功的单条译文；未启动/在途取消的 cue 返回原值；取消本身不追加重复错误。

所有 batch promise 都正常 resolve 为 `BatchResult`，因此外层 `Promise.all` 不会因主动取消丢弃先完成的批次结果。

聚合仍按 batch index/source order 组装。最终：

- `successCount` 为所有实际成功 cue 数。
- `failedCount = input.length - successCount`。
- `cancelled = signal.aborted || any batch cancelled`。
- `errors` 为普通失败的安全摘要，不含取消噪声。

取消批次不增加“已完成批次/条目”进度，避免用户点击取消后进度跳到 100%。最终页面改为结果计数，不依赖进度值表达取消状态。

### 4.2 安全错误

在共享 generation 边界统一生成受控错误，而不是让页面直接展示任意异常：

- HTTP 非 2xx 保留状态码；只从结构化 JSON `error.message` / `error` / `message` 读取原因，经敏感片段清理和限长后可展示。
- timeout、network、response parse 使用应用定义的固定分类；批次/条目位置由应用拼接。
- 所有已知 API credential/Authorization、request body、字幕、术语表和 custom/system/user prompt 值执行不区分大小写的精确打码；每个敏感区段替换为单个 `***` 并合并连续掩码。
- 精确打码后若仍与 API credential/Authorization 存在至少 4 个连续字符重叠，或与 request body、字幕、术语表、custom/system/user prompt 存在至少 8 个连续字符重叠，则丢弃整个服务端原因，只保留状态码。
- 任意底层异常文本仍在 generation 结果边界被丢弃；非 JSON response body 不展示。
- 页面最多展示前 20 条，并显示其余省略数量。
- 不将 `errors`、请求正文、subtitle、glossary 或 prompt 输出到 console。

完整成功由 `failedCount === 0 && !cancelled` 决定。批请求失败但 fallback 全部成功时仍视为完整成功，不因 `errors.length > 0` 误报部分失败。

## 5. TranslateView 状态与运行生命周期

### 5.1 页面状态

以 `TranslationResult | null` 保存当前逻辑结果，fatal `error` 独立保留。页面展示状态派生为：

- translating：运行中；
- success：未取消且 `failedCount === 0`；
- partial：未取消、`successCount > 0` 且 `failedCount > 0`；
- failed：未取消、`successCount === 0` 且 `failedCount > 0`；
- cancelled：`cancelled === true`；
- error：运行未产出结果即抛出 fatal error。

结果区域始终显示“成功 N 条、失败 M 条”。部分失败/取消不显示完整成功文案。

`taskStore` 不扩展 status enum：

- 完整成功：`success`；
- 部分失败：`error`，message 写明部分完成计数；
- 零成功失败：`error`，message 写明翻译失败计数；
- 页面内手动取消：`idle`，message 写明已取消及计数；
- 离开页面或切换视频导致的取消：`idle`，message 还须明确不会在后台继续运行；
- fatal error：`error`。

### 5.2 控制器与过期结果

组件持有当前 `AbortController` 与递增 run token/ref：

- 每次开始完整翻译或失败重试前 abort/替换旧 controller。
- “取消翻译”只在 provider 请求阶段可用；点击时同步标记 `cancelRequested` 并 abort 当前 controller，随后按钮禁用，等待 `translateBatch` 汇总部分结果。
- `translateBatch` settle 后先关闭取消窗口，再读取 `cancelRequested`。已在边界前接受的取消强制走不完整结果分支，即使最后一个 HTTP response 同时完成；边界后不再显示/接受取消，进入 apply/save 阶段。
- session video path 改变或组件卸载时 abort 并使 run token 失效；taskStore message 写明“翻译已取消，不会在后台继续运行”。
- progress、result、catch、finally 在写 React/task state 前校验当前 token。
- 沿用 `captureProjectDocumentGuard`，字幕或工作视频变化时放弃运行结果，不将过期结果合并或保存。

不增加 App-level poller；页面卸载即不再保留逻辑结果。状态栏与重新挂载的翻译页从 taskStore 展示上一次取消消息，避免用户误以为请求仍在后台运行。

## 6. 失败重试与结果合并

当前页的基准始终是 `sourceCues`。重试流程：

1. 从当前 `logicalResultCues` 选择 `!cue.secondaryText?.trim()` 的 cue。
2. 只把这些 cue 传给 provider；沿用相同 provider、目标语言、prompt、术语、批次和上下文设置。
3. 用 retry result 的 cue `id` 建 map。
4. 遍历原有 logical result，只替换 retry 返回且已有有效 `secondaryText` 的 cue；保留旧成功译文和原顺序。
5. 从 merged cues 重新计算累计 success/failed；`errors` 替换为本轮 retry 的错误；`cancelled` 使用本轮状态。

不提供自动重试、单条勾选、历史错误累计或重试次数配置。

上下文窗口在“重试失败条目”中只基于本轮失败 cue 列表计算；最小版本不为稀疏重试额外引入全量 source context 映射。

## 7. 保存策略

### 7.1 完整成功

保持现有行为：开始运行前执行一次 `confirmDiscardUnsavedChanges`；结果完整成功后用该 decision 与本次 document guard 自动应用并保存。

### 7.2 部分失败或取消

- 只更新页面的 `logicalResultCues` 和结果状态。
- 不调用 `setCues` / `setAssMetadata` / `setActiveSubtitle` / `saveAssText`。
- 有至少一条有效译文时显示“保存当前结果”；零成功时禁用或不显示保存。
- 显式保存时重新执行 `confirmDiscardUnsavedChanges`，不能复用运行开始前的 decision。

显式保存与完整成功共用 `TranslateView` 内的一个最小 apply/save helper，复用现有顺序：

1. 基于 project metadata 或 transcribed ASS 构造 base doc。
2. 按 `subtitleMergeMode` + `preserveOrder` 序列化 logical cues。
3. 以 `mergeBilingual: false` re-parse 为物理 rows。
4. `withDiscardedSubtitleRecovery` 内校验 guard 并更新 project store。
5. 同步捕获 immutable serialized payload 对应的 save snapshot/token。
6. 写入 `session.translatedAssPath`；同文档时设置 active translated path 并 `markSaved(token)`。
7. 写入失败时保留内存中的物理译稿为 dirty，active translated path 设为 `null`，沿用现有编辑器另存行为。

## 8. UI

复用现有 shadcn `Button` 和原生 `<details>`：

- 运行中显示“取消翻译”。
- 页面切换造成的取消在全局状态栏持续可见；重新进入翻译页时显示“上次翻译状态”。
- 部分/取消结果显示计数、`重试失败条目`、`保存当前结果`；零成功结果显示“翻译失败”，保存按钮保持禁用。
- 错误摘要用 `<details>` 展开，无新组件依赖。
- 完整成功显示“翻译完成，成功 N 条、失败 0 条”。
- “进入编辑”只在结果已应用到 project store 后可用，不能因页面内不完整 draft 存在就开放。
- 页面根容器使用 `min-h-0 flex-1 overflow-y-auto`，使新增状态区超出 AppLayout 工作区时可纵向滚动。

所有文案使用简体中文；不新增字符/emoji 图标。

## 9. 兼容与回滚

- 类型变更只影响内部 frontend translation service，无持久化或 IPC migration。
- provider protocol、batch prompt、concurrency/RPM 和 ASS merge mode 保持兼容；fallback 按本任务最终决策收窄到同一批次连续 2 次本地批量 JSON 校验失败。
- 若取消改动出现回归，可按边界回滚：先回滚 `TranslateView` 状态/UI，再回滚 provider signal，最后回滚 scheduler signal；每层都有聚焦测试。
