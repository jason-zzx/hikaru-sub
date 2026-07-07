# 文件中心工作流设计

## 概述

Hikaru Sub 的工作对象改为“视频文件 + 视频同目录的可见字幕文件”。应用不再在视频目录创建或读取旧隐藏项目目录，也不再把工作流状态保存到视频目录。所有中间文件，包括提取音频、ASR 恢复快照和压制临时 ASS，都放入应用缓存。

这个改动解决两个核心问题：

- 同一目录下多个视频不会因为共用一组隐藏项目文件而互相覆盖。
- 用户无需开启“显示隐藏项”，也能直接找到生成的字幕文件。

## 目标

- 不再创建、读取或迁移旧隐藏项目目录。
- 在视频同目录生成普通可见字幕文件。
- 转录字幕严格命名为 `<stem>.transcribed.ass`。
- 翻译字幕严格命名为 `<stem>.translated.ass`。
- 非用户交付物，包括提取音频、ASR 恢复数据、压制临时 ASS，全部存入应用缓存。
- ASR 模型、目标语言、翻译提供商等配置使用操作发生时的当前应用设置，不做每视频独立持久化。
- 用运行时 `VideoSession` 表示当前视频会话，替代旧项目元数据概念。

## 非目标

- 本次不做剧集批量管理。
- 本次不做旧项目迁移。
- 本次不保存每个视频独立的 ASR/翻译配置。
- 不重新暴露源语言选择。新会话仍固定以日语为源语言。
- 不在编辑页重构完整字幕内存模型；本次只把保存目标从 `secondaryText` 判断中解耦。

## 用户可见文件模型

对于视频 `episode01.mp4`，Hikaru Sub 生成：

```text
episode01.mp4
episode01.transcribed.ass
episode01.translated.ass
```

- `episode01.transcribed.ass`：ASR 转录后的原文字幕。
- `episode01.translated.ass`：翻译后的字幕文档，可以是双语 ASS。

这两个文件都是视频目录下的普通可见文件。用户可以直接在文件管理器中看到、复制、备份或用其他工具打开。

如果视频文件名本身已经包含 `.transcribed` 或 `.translated`，仍然按完整 stem 追加工作流后缀。例如 `clip.translated.mp4` 会生成 `clip.translated.transcribed.ass` 和 `clip.translated.translated.ass`。这条规则虽然有些重复，但确定性最好，也不会猜测用户文件名含义。

## 会话模型

前端仍然需要一个“当前工作对象”，但它只是内存中的视频会话，不是落盘项目。后端命令 `prepare_video_session` 返回 `VideoSession`：

```typescript
interface VideoSession {
  videoPath: string;
  workspacePath: string;
  audioPath: string;
  transcribedAssPath: string;
  translatedAssPath: string;
  burnAssPath: string;
  sourceLang: "ja";
}
```

`VideoSession` 的作用是把“这个视频对应的规范路径”一次性算好并交给前端使用。它不写入磁盘，不保存 ASR/翻译配置，也不承担项目元数据职责。

前端 store 额外保存当前字幕编辑目标：

```typescript
type ActiveSubtitleKind = "transcribed" | "translated";

interface ActiveSubtitleState {
  activeSubtitlePath: string | null;
  activeSubtitleKind: ActiveSubtitleKind | null;
}
```

编辑保存目标由 `activeSubtitlePath` 决定，而不是由字幕内容里是否存在 `secondaryText` 决定。

## 应用缓存布局

缓存目录使用 Tauri 的 app cache directory，不放在视频目录下。每个视频有一个稳定 workspace，key 来自 canonicalized absolute video path 的 hash，避免不同目录下同名视频冲突，也避免同一视频用相对路径和绝对路径打开时产生两个缓存 workspace。

布局：

```text
app-cache/
  workspace/
    <video-path-hash>/
      audio.wav
      burn.input.ass
      asr-jobs/
        <job-id>.json
```

`prepare_video_session` 创建 workspace。转录成功并确认转录字幕保存完成后删除 `audio.wav`；再次转录需要重新提取音轨。ASR 恢复快照与压制临时 ASS 保留在 workspace 中，作为可清理缓存。

## 工作流

### 打开视频

导入页的主操作是选择视频文件。用户选中视频后，应用创建内存会话并计算衍生路径。

打开视频时按以下顺序加载字幕：

1. 如果 `<stem>.translated.ass` 存在，优先加载它，并设置 `activeSubtitlePath` 为翻译字幕路径。
2. 否则如果 `<stem>.transcribed.ass` 存在，加载它，并设置 `activeSubtitlePath` 为转录字幕路径。
3. 否则创建空字幕状态，引导用户进入转录，`activeSubtitlePath` 保持为空。

如果已有字幕文件解析失败，视为对应阶段尚未完成：不弹非阻塞警告，不加载半成品。主流程中移除“打开已有项目/选择项目目录”。

### 下载后打开

下载完成后的操作只准备空视频会话，不自动加载旁边已有字幕。用户后续按正常转录、翻译、编辑流程继续。

### 转录

转录前将音频提取到缓存 workspace 的 `audio.wav`。ASR 使用这个缓存音频作为输入，并且输出路径必须严格来自 `VideoSession.transcribedAssPath`。

如果当前会话缺少 `transcribedAssPath`，转录不能启动。任何 ASR 层都不能自行猜测默认字幕输出路径。

ASR 完成后，前端加载生成的 ASS 到编辑状态，设置 `activeSubtitlePath` 为转录字幕路径。转录字幕保存成功后删除缓存音频 `audio.wav`。

重新转录只生成或覆盖 `<stem>.transcribed.ass`，不影响已有 `<stem>.translated.ass`。

### 翻译

翻译读取当前内存字幕文档。如果当前没有字幕文档，可以从 `VideoSession.transcribedAssPath` 加载。

翻译结果保存到 `VideoSession.translatedAssPath`。保存成功后设置 `activeSubtitlePath` 为翻译字幕路径。

现有双语序列化规则保持不变：

- 行内合并：`译文 / 原文` 写入一条 Dialogue。
- 分离双行：`Primary` 原文 + `Secondary` 译文，同时间轴两条 Dialogue。

### 编辑保存

编辑页保存到当前活动字幕文件：

- 如果当前打开的是 `<stem>.translated.ass`，无论用户如何编辑，保存仍写回 `<stem>.translated.ass`。
- 如果当前打开的是 `<stem>.transcribed.ass`，保存仍写回 `<stem>.transcribed.ass`。
- 如果还没有活动字幕文件，保存默认创建 `<stem>.transcribed.ass`，并把它设为当前活动字幕文件。

编辑页不再使用 `secondaryText` 判断保存到转录字幕还是翻译字幕。`secondaryText` 可以继续存在于翻译与 ASS 序列化流程中，但它不决定文件目标。

编辑页提供三个文件操作：

- 保存当前字幕。
- 选择字幕文件。
- 在文件夹中显示字幕。

`选择字幕文件` 行为：

- 允许用户选择任意 `.ass` 或 `.srt` 字幕文件。
- 用户选择的字幕作为完整 translated 字幕来源，替换当前编辑器中的所有 cues。
- 如果选择 `.ass`，解析为 ASS 文档，并用当前视频分辨率覆盖 `PlayResX/Y`。
- 如果选择 `.srt`，把 SRT 作为完整字幕文档转换为 ASS，并写入当前视频分辨率。
- 选择完成后设置当前活动字幕类型为 `translated`，但活动路径为 `null`；首次保存必须弹出另存为对话框，默认路径为 `<stem>.translated.ass`。
- 用户取消另存为时不写入文件，也不把外部来源文件绑定为后续覆盖目标。

`在文件夹中显示` 行为：

- 仅在当前活动字幕文件真实存在时启用。
- 文件不存在时禁用，不自动创建文件。

左下角全局状态栏不再显示“未保存”tag。编辑页顶部可以继续显示当前编辑内容的保存状态，例如外部字幕已载入但尚未选择保存目标时显示“待保存”。

### 压制

压制前把当前内存字幕序列化到缓存 workspace 的 `burn.input.ass`，再把该缓存路径传给 FFmpeg。视频目录不出现压制临时 ASS。

最终输出视频仍由用户选择保存路径。

## 后端与服务改动

- 用 `prepare_video_session` 替代旧项目创建/打开命令。
- 新增 `VideoSession` Rust/TypeScript 类型，不再继续使用旧项目元数据类型名。
- 后端路径 helper 统一计算：
  - 视频对应的缓存 workspace。
  - 视频旁边的转录 ASS 路径。
  - 视频旁边的翻译 ASS 路径。
  - 缓存内音频路径。
  - 缓存内压制 ASS 路径。
- `prepare_video_session` 创建缓存 workspace。
- ASR 恢复快照写入缓存 workspace 下的 `asr-jobs`。
- ASR 输出路径必须由前端传入 `transcribedAssPath`；未传输出路径时应失败或跳过写 ASS，不能猜测旧默认文件名。
- `save_ass_text` 不再自动创建任意父目录。保存可见字幕时，视频所在目录本来必须存在；保存缓存文件时，workspace 由 `prepare_video_session` 预先创建。
- 新增受限的缓存音频清理命令：只允许删除应用缓存 workspace 下名为 `audio.wav` 的文件。
- 移除选择父目录或旧隐藏项目目录打开项目的解析逻辑。
- 当前 capabilities 使用默认命令调用配置，新增 `prepare_video_session`、缓存音频清理命令只需在 `lib.rs` 注册；不需要修改 capabilities。

## UI 文案改动

用户界面应描述“视频”和“字幕文件”，避免继续暴露项目概念。

示例：

- `导入视频` 可以保留。
- `创建新项目并开始转录` 改为 `打开视频并开始转录`。
- `打开已有项目` 移除。
- 说明文案改成“字幕将保存到视频同目录”。

所有用户可见文案保持简体中文。新增编辑页文件操作按钮时，图标继续使用 `src/components/layout/NavIcons.tsx` 中的 SVG 图标，保持现有 lucide 风格，不使用 emoji 或字符图标。

## 错误处理

- 如果视频目录不可写，在转录或保存前提示：`无法写入视频所在目录，请检查权限或选择可写位置。`
- 如果目标字幕文件已存在，保存可以覆盖，因为它是该视频的规范输出文件；但“重新转录”可能覆盖用户修改的转录字幕，UI 应明确提示。
- 如果缓存准备失败，显示缓存相关错误，不向视频目录写入半成品。
- 如果已有字幕加载或解析失败，按对应阶段尚未完成处理。
- 如果当前没有字幕文件，“选择字幕文件”仍允许用户选择外部 ASS/SRT 作为 translated 来源；首次保存时再选择保存位置。
- 如果当前没有字幕文件，“在文件夹中显示”保持禁用。

## 测试

Rust/Tauri 测试：

- 普通文件名、多点文件名、Unicode 文件名的字幕路径推导。
- 不同目录下同名视频的缓存 workspace 不冲突。
- 相对路径和规范化绝对路径指向同一视频时使用同一 workspace。
- 准备视频会话不会创建旧隐藏项目目录。
- `save_ass_text` 不自动创建不存在的父目录。
- 缓存音频清理命令只能删除 app cache workspace 下的 `audio.wav`。
- ASR 恢复快照写入缓存 workspace。
- `start_asr` 缺少输出 ASS 路径时失败。

Python ASR 测试：

- 有 `outputAssPath` 时写入指定转录字幕。
- 无 `outputAssPath` 时不写入默认字幕文件。
- 恢复快照写入音频父目录下的 `asr-jobs`。

前端测试：

- `VideoSession` 类型和服务 helper 不包含旧项目元数据语义。
- 打开视频时优先加载 `<stem>.translated.ass`，并设置活动字幕路径。
- 只有转录字幕时加载 `<stem>.transcribed.ass`，并设置活动字幕路径。
- 下载完成后只准备空会话，不自动加载字幕。
- 转录保存到 `transcribedAssPath`，成功后设置活动字幕路径并清理缓存音频。
- 翻译保存到 `translatedAssPath`，成功后设置活动字幕路径。
- 编辑保存使用 `activeSubtitlePath`，不再由 `secondaryText` 决定。
- “选择字幕文件”可选择外部 ASS/SRT；SRT 转 ASS，ASS/SRT 均写入当前视频分辨率。
- 外部字幕作为完整 translated 文档载入，首次保存弹出另存为并默认 `<stem>.translated.ass`。
- 左下角全局状态栏不显示“未保存”tag。
- “在文件夹中显示”在文件不存在时禁用。
- 压制临时 ASS 写入缓存，而不是视频目录。

手动验证：

- 同一文件夹放多个视频，逐个转录后确认字幕文件互不覆盖。
- 确认生成字幕在文件管理器中可见，不依赖“显示隐藏项”。
- 打开已有 translated 字幕，删除所有译文后保存，仍写回 translated 字幕。
- 重新转录只覆盖 transcribed 字幕，不影响 translated 字幕。
- 清理应用缓存不会删除用户可见字幕文件。

## 文档更新

实现后同步更新所有仍描述旧项目模型的文档，包括 `README.md`、`AGENTS.md`、ASR sidecar README 和相关发布说明：

- 用户可见字幕输出位于视频同目录。
- 中间音频、ASR 恢复、压制临时 ASS 位于应用缓存。
- 新会话使用当前应用设置作为 ASR 与翻译配置来源。
- 旧隐藏项目目录不再是支持的文件模型。

## 已确认决策

- 不再保留旧隐藏项目模型。
- 不做旧项目兼容读取或迁移。
- 使用 `VideoSession` 运行时会话对象。
- 转录字幕严格使用 `<stem>.transcribed.ass`。
- 翻译字幕严格使用 `<stem>.translated.ass`。
- 转录输出路径必须来自 `transcribedAssPath`。
- 编辑保存目标由 `activeSubtitlePath` 决定，不由 `secondaryText` 决定。
- 下载完成后只准备空会话。
- 转录成功保存后删除缓存音频。
- 不做每视频独立配置持久化。
