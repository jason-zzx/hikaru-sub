# 捆绑的 FFmpeg 二进制

本目录用于存放随应用打包的 FFmpeg 可执行文件，**二进制本身不纳入 git**。

- 开发时无需放置：运行时会自动回退到系统 PATH 中的 `ffmpeg`。
- 打包发布前，先拉取对应平台的静态二进制：

```bash
pnpm ffmpeg:fetch
```

脚本会把可执行文件放到本目录：

| 平台 | 文件名 |
|------|--------|
| Windows | `ffmpeg.exe` |
| macOS / Linux | `ffmpeg` |

运行时解析优先级：**用户设置中的路径 → 本目录捆绑二进制 → 系统 PATH**。

## 许可证提示

静态 FFmpeg 多为 GPL 构建（含 x264 等）。分发 GPL 二进制需遵守 GPL 条款
（随包提供对应源码或书面 offer，并保留版权与许可声明）。如需降低合规负担，
可改用 LGPL 构建变体（如 BtbN 的 `*-lgpl` 包）。
