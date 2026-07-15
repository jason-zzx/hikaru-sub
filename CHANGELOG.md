# 更新日志

## [0.1.0] - 2026-07-15

### 新增

- 支持下载或导入视频、片段切取、本地日语转录、批量翻译、字幕校对和成片输出。
- 支持 faster-whisper、kotoba-faster-whisper、Parakeet 和 Qwen3-ASR，并按需准备运行时依赖与模型。
- 支持 ASS 双语字幕、样式编辑、libass 预览、音频波形和多泳道时间轴。
- Windows 提供 NSIS 安装包和 portable zip 两种发行形式。

### 重要说明

- 当前仅发布 Windows 构建，macOS 与 Linux 暂未开放下载。
- Windows 构建暂未代码签名，首次启动时可能显示 Microsoft SmartScreen 提示。
- 发布包不捆绑 FFmpeg、Python 3.11、ASR Python 依赖或模型权重；相关依赖在用户确认后按需准备。
