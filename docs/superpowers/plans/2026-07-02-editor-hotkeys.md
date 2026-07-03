# 编辑页快捷键体系实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑页建立 Aegisub 式快捷键体系：字幕导航、播放头控制（逐帧/快跳/边界跳转）、对轴打点、编辑操作，以及统一的焦点感知分发层与键位速查浮层。

**Architecture:** 集中式自建——声明式键位表（`hotkeys.ts`）+ 单一 keydown 分发器（`useEditorHotkeys`）+ 纯函数动作层（`editorActions.ts`）。Enter/Esc 等依赖编辑框草稿状态的键由 SubtitleEditor 本地处理（键位表中标记 `handledLocally`，仅供速查浮层展示）。后端唯一改动：`get_video_info` 补 fps 字段。

**Tech Stack:** React 19 + TypeScript + Zustand + vitest（`pnpm test`）；Rust/Tauri（`cargo test`）。

**Spec:** `docs/superpowers/specs/2026-07-02-editor-hotkeys-design.md`

> **⚠️ 提交规则（优先于本计划所有步骤）：** 按项目 AGENTS.md 最高优先级规则，**各任务末尾的 Commit 步骤仅为流程说明**，执行者不得主动执行 `git commit`；须在该步骤暂停，待用户单独、明确授权后方可提交，或经用户指示跳过。

---

## 文件结构总览

| 文件 | 动作 | 职责 |
|------|------|------|
| `src-tauri/src/ffmpeg.rs` | 修改 | `VideoInfo` 补 `fps: Option<f64>`；ffprobe 输出改 key=value 解析（纯函数 + 单测） |
| `src/types/index.ts` | 修改 | `VideoInfo.fps: number \| null` |
| `src/services/editorActions.ts` | 新建 | 纯函数动作层：相邻选择、边界跳转、帧步进、追加行、新建 cue、提交后去向 |
| `src/services/editorActions.test.ts` | 新建 | 上述纯函数单测 |
| `src/components/editor/hotkeys.ts` | 新建 | 键位表数据 + `findHotkey` 匹配器 + `isEditableTarget` |
| `src/components/editor/hotkeys.test.ts` | 新建 | 匹配器与作用域过滤单测 |
| `src/stores/playbackStore.ts` | 修改 | `fps`、`playUntilMs`；`setPlaying(false)` 时清除 `playUntilMs` |
| `src/stores/uiStore.ts` | 修改 | `editorFocusNonce` + `requestEditorFocus()`（Insert 新建后聚焦编辑框） |
| `src/stores/playbackStore.test.ts` | 新建 | 暂停清除 playUntil 的语义单测 |
| `src/hooks/useEditorHotkeys.ts` | 新建 | `buildEditorActions`（actionId → 动作，经 zustand `getState` 组合纯函数）+ hook 挂 window keydown |
| `src/hooks/useEditorHotkeys.test.ts` | 新建 | 动作层集成单测（直接操作 store 断言） |
| `src/components/editor/EditorView.tsx` | 修改 | 移除旧快捷键 effect，接入 hook 与速查浮层 |
| `src/components/editor/SubtitleEditor.tsx` | 修改 | 草稿模型改造 + Enter/Shift+Enter/Esc + 最后一条追加行 + 聚焦请求 |
| `src/components/player/VideoPlayer.tsx` | 修改 | `playUntilMs` 到点自动暂停；加载时获取 fps |
| `src/components/player/PlaybackControls.tsx` | 修改 | 按钮 title 标注快捷键 |
| `src/components/editor/SubtitleList.tsx` | 修改 | 点击列表清除 `playUntilMs`（用户主动切换中断播放段） |
| `src/components/editor/HotkeyHelpOverlay.tsx` | 新建 | `?` 键呼出的键位速查浮层 |
| `src/components/editor/HotkeyHelpOverlay.test.ts` | 新建 | 分组函数单测 |
| `tests/SubtitleEditorBehavior.test.ts` | 新建 | 组件源码断言（IME 保护、Esc 守卫等，沿用 `tests/BurnView.test.ts` 风格） |
| `README.md` | 修改 | 待优化清单与编辑器功能说明更新 |

测试基线：项目无 @testing-library/jsdom，vitest 跑 node 环境。因此所有可测逻辑都下沉到纯函数/store（结构化类型入参，不依赖真实 DOM），组件层用源码断言 + `pnpm build`（含 tsc）+ 手测清单兜底。

---

### Task 1: Rust — `VideoInfo.fps` 字段与 ffprobe 解析重构

现状 `get_video_info` 用 csv 位置解析（`ffmpeg.rs:286-319`）。ffprobe 的 csv 字段输出顺序由内部定义决定而非请求顺序，追加 `r_frame_rate` 后位置解析易错，改为 `key=value` 行解析并抽出纯函数。

**Files:**
- Modify: `src-tauri/src/ffmpeg.rs`（`VideoInfo` 结构体 :39-43、`get_video_info` :265-326、文件末尾加测试模块）
- Modify: `src/types/index.ts`（`VideoInfo` :161-165）

- [ ] **Step 1: 写失败的 Rust 单测**

在 `src-tauri/src/ffmpeg.rs` 文件末尾追加：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_video_info_normal() {
        let out = "width=1920\nheight=1080\nr_frame_rate=30000/1001\navg_frame_rate=30000/1001\nduration=1445.361000\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.width, 1920);
        assert_eq!(info.height, 1080);
        assert_eq!(info.duration_ms, 1445361);
        let fps = info.fps.unwrap();
        assert!((fps - 29.97).abs() < 0.01);
    }

    #[test]
    fn parse_video_info_r_frame_rate_invalid_falls_back_to_avg() {
        let out = "width=1280\nheight=720\nr_frame_rate=0/0\navg_frame_rate=25/1\nduration=10.0\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.fps, Some(25.0));
    }

    #[test]
    fn parse_video_info_missing_fps_and_duration() {
        let out = "width=640\nheight=480\nr_frame_rate=N/A\navg_frame_rate=0/0\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.fps, None);
        assert_eq!(info.duration_ms, 0);
    }

    #[test]
    fn parse_video_info_missing_dimensions_errors() {
        assert!(parse_video_info_output("duration=1.0\n").is_err());
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_video_info`
Expected: 编译错误 `cannot find function parse_video_info_output`（以及 `VideoInfo` 无 `fps` 字段）

- [ ] **Step 3: 实现**

修改 `VideoInfo` 结构体（`ffmpeg.rs:37-43`）：

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub duration_ms: i64,
    /// 视频帧率（r_frame_rate 优先，回退 avg_frame_rate），无法解析时为 None
    pub fps: Option<f64>,
}
```

在 `get_video_info` 上方新增两个纯函数：

```rust
/// 解析 ffprobe 的 "30000/1001" 形式帧率；无效（0/0、N/A、非正数）返回 None。
fn parse_rational_fps(value: &str) -> Option<f64> {
    let v = value.trim();
    if v.is_empty() || v == "N/A" {
        return None;
    }
    if let Some((num, den)) = v.split_once('/') {
        let num: f64 = num.parse().ok()?;
        let den: f64 = den.parse().ok()?;
        if den == 0.0 || num <= 0.0 {
            return None;
        }
        return Some(num / den);
    }
    v.parse::<f64>().ok().filter(|f| *f > 0.0)
}

/// 解析 ffprobe `-of default=noprint_wrappers=1` 的 key=value 输出。
fn parse_video_info_output(stdout: &str) -> Result<VideoInfo, String> {
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    let mut duration_ms: i64 = 0;
    let mut r_fps: Option<f64> = None;
    let mut avg_fps: Option<f64> = None;

    for line in stdout.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        match key {
            "width" => width = value.parse().ok(),
            "height" => height = value.parse().ok(),
            "duration" => {
                duration_ms = value
                    .parse::<f64>()
                    .ok()
                    .map(|d| (d * 1000.0) as i64)
                    .unwrap_or(0)
            }
            "r_frame_rate" => r_fps = parse_rational_fps(value),
            "avg_frame_rate" => avg_fps = parse_rational_fps(value),
            _ => {}
        }
    }

    let width = width.ok_or("无法解析宽度")?;
    let height = height.ok_or("无法解析高度")?;
    Ok(VideoInfo {
        width,
        height,
        duration_ms,
        fps: r_fps.or(avg_fps),
    })
}
```

替换 `get_video_info` 中 ffprobe 调用参数与解析段（原 :286-325）：

```rust
    let output = Command::new(&ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration,r_frame_rate,avg_frame_rate",
            "-of", "default=noprint_wrappers=1",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe 失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    parse_video_info_output(&String::from_utf8_lossy(&output.stdout))
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_video_info`
Expected: `test result: ok. 4 passed`

- [ ] **Step 5: 前端类型同步**

修改 `src/types/index.ts:161-165`：

```typescript
export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
  /** 视频帧率；后端无法探测时为 null */
  fps: number | null;
}
```

- [ ] **Step 6: 前端构建验证**

Run: `pnpm build`
Expected: tsc 无错误（`fps` 为新增字段，现有调用方不受影响）

- [ ] **Step 7: Commit（需用户授权，见页首注记）**

```bash
git add src-tauri/src/ffmpeg.rs src/types/index.ts
git commit -m "feat(ffmpeg): add fps to get_video_info via key=value ffprobe parsing"
```

---

### Task 2: `editorActions` 纯函数层

**Files:**
- Create: `src/services/editorActions.ts`
- Test: `src/services/editorActions.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `src/services/editorActions.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import {
  appendCueAfter,
  createCueAtPlayhead,
  findSubtitleBoundary,
  frameStepTarget,
  nextAfterCommit,
  selectCueByOffset,
} from "./editorActions";
import type { SubtitleCue } from "../types";

function cue(id: string, startMs: number, endMs: number): SubtitleCue {
  return { id, startMs, endMs, primaryText: id, style: "Primary", layer: 0 };
}

const CUES = [cue("a", 0, 1000), cue("b", 2000, 3000), cue("c", 5000, 6000)];

describe("selectCueByOffset", () => {
  it("选中下一条/上一条", () => {
    expect(selectCueByOffset(CUES, "a", 1)?.id).toBe("b");
    expect(selectCueByOffset(CUES, "b", -1)?.id).toBe("a");
  });

  it("越界收在首/末条", () => {
    expect(selectCueByOffset(CUES, "a", -1)?.id).toBe("a");
    expect(selectCueByOffset(CUES, "c", 1)?.id).toBe("c");
    expect(selectCueByOffset(CUES, "a", Infinity)?.id).toBe("c");
    expect(selectCueByOffset(CUES, "c", -Infinity)?.id).toBe("a");
  });

  it("未选中时从第一条开始；空列表返回 null", () => {
    expect(selectCueByOffset(CUES, null, 1)?.id).toBe("a");
    expect(selectCueByOffset([], null, 1)).toBeNull();
  });
});

describe("findSubtitleBoundary", () => {
  it("找到后方最近边界（跳过 1ms 容差内的当前位置）", () => {
    expect(findSubtitleBoundary(CUES, 500, 1)).toBe(1000);
    expect(findSubtitleBoundary(CUES, 1000, 1)).toBe(2000);
    expect(findSubtitleBoundary(CUES, 1000.4, 1)).toBe(2000);
  });

  it("找到前方最近边界", () => {
    expect(findSubtitleBoundary(CUES, 2500, -1)).toBe(2000);
    expect(findSubtitleBoundary(CUES, 2000, -1)).toBe(1000);
  });

  it("越过首/末边界或空列表返回 null", () => {
    expect(findSubtitleBoundary(CUES, 0, -1)).toBeNull();
    expect(findSubtitleBoundary(CUES, 6000, 1)).toBeNull();
    expect(findSubtitleBoundary([], 100, 1)).toBeNull();
  });
});

describe("frameStepTarget", () => {
  it("按 fps 帧中心步进", () => {
    // 25fps：一帧 40ms；当前 0ms（第 0 帧）→ 下一帧中心 = 1.5 × 40 = 60ms
    expect(frameStepTarget(0, 25, 1, 60000)).toBeCloseTo(60);
    // 回退一帧被 clamp 到 0
    expect(frameStepTarget(0, 25, -1, 60000)).toBe(0);
  });

  it("fps 为 null 或非正时按 30fps 回退", () => {
    // 30fps：一帧 ≈33.33ms；0ms → 下一帧中心 = 1.5 × 33.33 ≈ 50ms
    expect(frameStepTarget(0, null, 1, 60000)).toBeCloseTo(50, 0);
    expect(frameStepTarget(0, 0, 1, 60000)).toBeCloseTo(50, 0);
  });

  it("clamp 到时长", () => {
    expect(frameStepTarget(59990, 25, 10, 60000)).toBe(60000);
  });
});

describe("appendCueAfter", () => {
  it("起点接当前行结束、时长 2s、文本空、继承样式与 layer", () => {
    const base: SubtitleCue = {
      id: "x",
      startMs: 1000,
      endMs: 3000,
      primaryText: "text",
      secondaryText: "译",
      style: "Secondary",
      layer: 2,
    };
    const appended = appendCueAfter(base);
    expect(appended.id).toBeTruthy();
    expect(appended.id).not.toBe("x");
    expect(appended.startMs).toBe(3000);
    expect(appended.endMs).toBe(5000);
    expect(appended.primaryText).toBe("");
    expect(appended.secondaryText).toBeUndefined();
    expect(appended.style).toBe("Secondary");
    expect(appended.layer).toBe(2);
  });
});

describe("createCueAtPlayhead", () => {
  it("沿用现有新建参数：2s、占位文本、Primary、layer 0", () => {
    const created = createCueAtPlayhead(1234);
    expect(created.startMs).toBe(1234);
    expect(created.endMs).toBe(3234);
    expect(created.primaryText).toBe("新建字幕");
    expect(created.style).toBe("Primary");
    expect(created.layer).toBe(0);
  });
});

describe("nextAfterCommit", () => {
  it("中间行提交后选中下一条", () => {
    const result = nextAfterCommit(CUES, "a");
    expect(result).toEqual({ kind: "select", cue: CUES[1] });
  });

  it("最后一条提交后追加", () => {
    const result = nextAfterCommit(CUES, "c");
    expect(result.kind).toBe("append");
    if (result.kind === "append") {
      expect(result.base.id).toBe("c");
    }
  });

  it("找不到 id 时返回 none", () => {
    expect(nextAfterCommit(CUES, "missing")).toEqual({ kind: "none" });
    expect(nextAfterCommit([], "a")).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test editorActions`
Expected: FAIL — `Cannot find module './editorActions'`

- [ ] **Step 3: 实现**

创建 `src/services/editorActions.ts`：

```typescript
import { createId } from "@hikaru/ass-core";
import type { SubtitleCue } from "../types";

/**
 * 按列表顺序选择相邻字幕；offset 越界时收在首/末条（±Infinity 即跳首/末）。
 * 未选中时从第一条开始；空列表返回 null。
 */
export function selectCueByOffset(
  cues: SubtitleCue[],
  selectedId: string | null,
  offset: number,
): SubtitleCue | null {
  if (cues.length === 0) return null;
  const idx = selectedId ? cues.findIndex((c) => c.id === selectedId) : -1;
  if (idx < 0) return cues[0];
  const next = Math.max(0, Math.min(cues.length - 1, idx + offset));
  return cues[next];
}

/**
 * 边界跳转：全部 cue 的开始/结束时间点排序去重后，
 * 找当前位置前/后最近的边界；1ms 容差避免帧中心 seek 后原地踏步。
 */
export function findSubtitleBoundary(
  cues: SubtitleCue[],
  currentMs: number,
  direction: -1 | 1,
): number | null {
  if (cues.length === 0) return null;
  const boundaries = [...new Set(cues.flatMap((c) => [c.startMs, c.endMs]))].sort(
    (a, b) => a - b,
  );
  if (direction > 0) {
    return boundaries.find((b) => b > currentMs + 1) ?? null;
  }
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (boundaries[i] < currentMs - 1) return boundaries[i];
  }
  return null;
}

/** 帧步进：取目标帧中心时间避免边界抖动；fps 无效时按 30fps 回退。 */
export function frameStepTarget(
  currentMs: number,
  fps: number | null,
  frames: number,
  durationMs: number,
): number {
  const effectiveFps = fps && fps > 0 ? fps : 30;
  const frameIdx = Math.round((currentMs * effectiveFps) / 1000);
  const targetMs = ((frameIdx + frames + 0.5) * 1000) / effectiveFps;
  return Math.max(0, Math.min(durationMs, targetMs));
}

/** Enter 在最后一条时的追加行：起点接当前行结束，时长 2s，文本空，继承样式与 layer。 */
export function appendCueAfter(cue: SubtitleCue): SubtitleCue {
  return {
    id: createId(),
    startMs: cue.endMs,
    endMs: cue.endMs + 2000,
    primaryText: "",
    secondaryText: undefined,
    style: cue.style,
    layer: cue.layer,
  };
}

/** Insert 新建：沿用现有新建参数（2s、占位文本、Primary、layer 0）。 */
export function createCueAtPlayhead(currentTimeMs: number): SubtitleCue {
  return {
    id: createId(),
    startMs: currentTimeMs,
    endMs: currentTimeMs + 2000,
    primaryText: "新建字幕",
    secondaryText: undefined,
    style: "Primary",
    layer: 0,
  };
}

export type CommitFollowUp =
  | { kind: "select"; cue: SubtitleCue }
  | { kind: "append"; base: SubtitleCue }
  | { kind: "none" };

/** Enter 提交后的去向：中间行 → 下一条；最后一条 → 追加；找不到 → 无动作。 */
export function nextAfterCommit(
  cues: SubtitleCue[],
  committedId: string,
): CommitFollowUp {
  const idx = cues.findIndex((c) => c.id === committedId);
  if (idx < 0) return { kind: "none" };
  if (idx === cues.length - 1) return { kind: "append", base: cues[idx] };
  return { kind: "select", cue: cues[idx + 1] };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test editorActions`
Expected: PASS（6 个 describe 全绿）

- [ ] **Step 5: Commit（需用户授权，见页首注记）**

```bash
git add src/services/editorActions.ts src/services/editorActions.test.ts
git commit -m "feat(editor): add pure action helpers for hotkey system"
```

---

### Task 3: 键位表与匹配器 `hotkeys.ts`

**Files:**
- Create: `src/components/editor/hotkeys.ts`
- Test: `src/components/editor/hotkeys.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `src/components/editor/hotkeys.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import {
  EDITOR_HOTKEYS,
  findHotkey,
  isEditableTarget,
  type HotkeyEventLike,
} from "./hotkeys";

function ev(overrides: Partial<HotkeyEventLike>): HotkeyEventLike {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    target: null,
    ...overrides,
  };
}

const TEXTAREA = { tagName: "TEXTAREA" };
const INPUT = { tagName: "INPUT" };
const BODY = { tagName: "BODY" };

describe("isEditableTarget", () => {
  it("textarea/input/contentEditable 视为框内", () => {
    expect(isEditableTarget(TEXTAREA)).toBe(true);
    expect(isEditableTarget(INPUT)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("body/null 视为框外", () => {
    expect(isEditableTarget(BODY)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("findHotkey", () => {
  it("框外方向键匹配帧步进与导航", () => {
    expect(findHotkey(ev({ key: "ArrowRight", target: BODY }))?.action).toBe("frame-next");
    expect(findHotkey(ev({ key: "ArrowDown", target: BODY }))?.action).toBe("select-next");
  });

  it("修饰键区分边界跳转与快速跳帧", () => {
    expect(findHotkey(ev({ key: "ArrowLeft", ctrlKey: true, target: BODY }))?.action).toBe("boundary-prev");
    expect(findHotkey(ev({ key: "ArrowLeft", altKey: true, target: BODY }))?.action).toBe("frame-fast-prev");
  });

  it("框内屏蔽 outside-input 键", () => {
    expect(findHotkey(ev({ key: " ", target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "ArrowDown", target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "Delete", target: INPUT }))).toBeNull();
  });

  it("global 键在框内外都生效", () => {
    expect(findHotkey(ev({ key: "3", ctrlKey: true, target: TEXTAREA }))?.action).toBe("stamp-start");
    expect(findHotkey(ev({ key: "4", ctrlKey: true, target: BODY }))?.action).toBe("stamp-end");
    expect(findHotkey(ev({ key: "ArrowDown", altKey: true, target: TEXTAREA }))?.action).toBe("select-next");
    expect(findHotkey(ev({ key: "s", ctrlKey: true, target: TEXTAREA }))?.action).toBe("save");
  });

  it("metaKey 等价 ctrl（macOS）", () => {
    expect(findHotkey(ev({ key: "s", metaKey: true, target: BODY }))?.action).toBe("save");
  });

  it("Ctrl+Z 框内不匹配（放行原生文本撤销），框外匹配 undo", () => {
    expect(findHotkey(ev({ key: "z", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "z", ctrlKey: true, target: BODY }))?.action).toBe("undo");
    expect(findHotkey(ev({ key: "z", ctrlKey: true, shiftKey: true, target: BODY }))?.action).toBe("redo");
    expect(findHotkey(ev({ key: "y", ctrlKey: true, target: BODY }))?.action).toBe("redo");
  });

  it("IME 组词中一律不匹配", () => {
    expect(findHotkey(ev({ key: "3", ctrlKey: true, isComposing: true, target: BODY }))).toBeNull();
  });

  it("? 呼出速查（Shift+/ 产生的 key）", () => {
    expect(findHotkey(ev({ key: "?", shiftKey: true, target: BODY }))?.action).toBe("toggle-help");
  });

  it("handledLocally 的键分发器跳过（Enter 由 SubtitleEditor 处理）", () => {
    expect(findHotkey(ev({ key: "Enter", target: TEXTAREA }))).toBeNull();
    const enterDef = EDITOR_HOTKEYS.find((d) => d.key === "Enter" && !d.shift);
    expect(enterDef?.handledLocally).toBe(true);
  });

  it("未定义组合不匹配", () => {
    expect(findHotkey(ev({ key: "q", target: BODY }))).toBeNull();
    expect(findHotkey(ev({ key: "r", ctrlKey: true, target: BODY }))).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test src/components/editor/hotkeys`
Expected: FAIL — `Cannot find module './hotkeys'`

- [ ] **Step 3: 实现**

创建 `src/components/editor/hotkeys.ts`：

```typescript
export type HotkeyScope = "global" | "outside-input" | "inside-input";

export type EditorActionId =
  | "select-prev"
  | "select-next"
  | "select-first"
  | "select-last"
  | "select-page-up"
  | "select-page-down"
  | "toggle-play"
  | "frame-prev"
  | "frame-next"
  | "frame-fast-prev"
  | "frame-fast-next"
  | "boundary-prev"
  | "boundary-next"
  | "play-segment"
  | "stamp-start"
  | "stamp-end"
  | "new-cue"
  | "delete-cue"
  | "commit-and-next"
  | "insert-newline"
  | "discard-draft"
  | "save"
  | "undo"
  | "redo"
  | "toggle-help";

export interface HotkeyDef {
  /** KeyboardEvent.key（单字符统一小写比较；命名键如 ArrowUp 原样） */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  scope: HotkeyScope;
  action: EditorActionId;
  /** 速查浮层展示的按键文案 */
  label: string;
  description: string;
  category: "导航" | "播放" | "打点" | "编辑" | "系统";
  /** 由组件本地处理（需要草稿状态），分发器跳过，仅供速查浮层展示 */
  handledLocally?: boolean;
}

export const EDITOR_HOTKEYS: HotkeyDef[] = [
  // 导航与选择
  { key: "ArrowUp", scope: "outside-input", action: "select-prev", label: "↑", description: "选中上一条字幕", category: "导航" },
  { key: "ArrowDown", scope: "outside-input", action: "select-next", label: "↓", description: "选中下一条字幕", category: "导航" },
  { key: "ArrowUp", alt: true, scope: "global", action: "select-prev", label: "Alt+↑", description: "选中上一条（编辑框内可用）", category: "导航" },
  { key: "ArrowDown", alt: true, scope: "global", action: "select-next", label: "Alt+↓", description: "选中下一条（编辑框内可用）", category: "导航" },
  { key: "Home", scope: "outside-input", action: "select-first", label: "Home", description: "跳到第一条", category: "导航" },
  { key: "End", scope: "outside-input", action: "select-last", label: "End", description: "跳到最后一条", category: "导航" },
  { key: "PageUp", scope: "outside-input", action: "select-page-up", label: "PgUp", description: "向上跳 10 条", category: "导航" },
  { key: "PageDown", scope: "outside-input", action: "select-page-down", label: "PgDn", description: "向下跳 10 条", category: "导航" },
  // 播放头控制
  { key: " ", scope: "outside-input", action: "toggle-play", label: "空格", description: "播放 / 暂停", category: "播放" },
  { key: "ArrowLeft", scope: "outside-input", action: "frame-prev", label: "←", description: "上一帧", category: "播放" },
  { key: "ArrowRight", scope: "outside-input", action: "frame-next", label: "→", description: "下一帧", category: "播放" },
  { key: "ArrowLeft", alt: true, scope: "outside-input", action: "frame-fast-prev", label: "Alt+←", description: "快退 10 帧", category: "播放" },
  { key: "ArrowRight", alt: true, scope: "outside-input", action: "frame-fast-next", label: "Alt+→", description: "快进 10 帧", category: "播放" },
  { key: "ArrowLeft", ctrl: true, scope: "outside-input", action: "boundary-prev", label: "Ctrl+←", description: "跳至上一个字幕边界", category: "播放" },
  { key: "ArrowRight", ctrl: true, scope: "outside-input", action: "boundary-next", label: "Ctrl+→", description: "跳至下一个字幕边界", category: "播放" },
  { key: "r", scope: "outside-input", action: "play-segment", label: "R", description: "播放当前字幕段（再按中断）", category: "播放" },
  // 对轴打点
  { key: "3", ctrl: true, scope: "global", action: "stamp-start", label: "Ctrl+3", description: "播放位置写入开始时间", category: "打点" },
  { key: "4", ctrl: true, scope: "global", action: "stamp-end", label: "Ctrl+4", description: "播放位置写入结束时间", category: "打点" },
  // 编辑操作
  { key: "Enter", scope: "inside-input", action: "commit-and-next", label: "Enter", description: "提交并跳到下一条（最后一条时追加新行）", category: "编辑", handledLocally: true },
  { key: "Enter", shift: true, scope: "inside-input", action: "insert-newline", label: "Shift+Enter", description: "插入换行", category: "编辑", handledLocally: true },
  { key: "Escape", scope: "inside-input", action: "discard-draft", label: "Esc", description: "放弃未提交草稿并失焦", category: "编辑", handledLocally: true },
  { key: "Insert", scope: "outside-input", action: "new-cue", label: "Insert", description: "在播放头位置新建字幕", category: "编辑" },
  { key: "Delete", scope: "outside-input", action: "delete-cue", label: "Delete", description: "删除选中字幕（可撤销）", category: "编辑" },
  // 系统
  { key: "s", ctrl: true, scope: "global", action: "save", label: "Ctrl+S", description: "保存", category: "系统" },
  { key: "z", ctrl: true, scope: "outside-input", action: "undo", label: "Ctrl+Z", description: "撤销（编辑框内为文本撤销）", category: "系统" },
  { key: "y", ctrl: true, scope: "outside-input", action: "redo", label: "Ctrl+Y", description: "重做", category: "系统" },
  { key: "z", ctrl: true, shift: true, scope: "outside-input", action: "redo", label: "Ctrl+Shift+Z", description: "重做", category: "系统" },
  { key: "?", shift: true, scope: "outside-input", action: "toggle-help", label: "?", description: "键位速查", category: "系统" },
];

/** 结构化事件类型：便于在 node 环境下不依赖 DOM 测试。 */
export interface HotkeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target?: unknown;
}

/** input/textarea/contentEditable 视为「框内」。鸭子类型判断，测试无需真实 DOM。 */
export function isEditableTarget(target: unknown): boolean {
  const el = target as
    | { tagName?: string; isContentEditable?: boolean }
    | null
    | undefined;
  if (!el) return false;
  return (
    el.tagName === "TEXTAREA" ||
    el.tagName === "INPUT" ||
    el.isContentEditable === true
  );
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * 在键位表中匹配事件；不匹配返回 null。
 * - IME 组词中（isComposing）一律不匹配
 * - metaKey 等价 ctrl（macOS）
 * - handledLocally 的条目跳过（由组件本地处理）
 */
export function findHotkey(
  e: HotkeyEventLike,
  defs: HotkeyDef[] = EDITOR_HOTKEYS,
): HotkeyDef | null {
  if (e.isComposing) return null;
  const inEditable = isEditableTarget(e.target);
  const ctrl = e.ctrlKey || e.metaKey;
  const key = normalizeKey(e.key);

  for (const def of defs) {
    if (def.handledLocally) continue;
    if (normalizeKey(def.key) !== key) continue;
    if (!!def.ctrl !== ctrl) continue;
    if (!!def.alt !== e.altKey) continue;
    if (!!def.shift !== e.shiftKey) continue;
    if (def.scope === "outside-input" && inEditable) continue;
    if (def.scope === "inside-input" && !inEditable) continue;
    return def;
  }
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test src/components/editor/hotkeys`
Expected: PASS

- [ ] **Step 5: Commit（需用户授权，见页首注记）**

```bash
git add src/components/editor/hotkeys.ts src/components/editor/hotkeys.test.ts
git commit -m "feat(editor): add declarative hotkey table and matcher"
```

---

### Task 4: Store 扩展（playbackStore / uiStore）

**Files:**
- Modify: `src/stores/playbackStore.ts`
- Modify: `src/stores/uiStore.ts`
- Test: `src/stores/playbackStore.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `src/stores/playbackStore.test.ts`：

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { usePlaybackStore } from "./playbackStore";

describe("playbackStore playUntil 语义", () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentTimeMs: 0,
      durationMs: 60000,
      isPlaying: false,
      selectedCueId: null,
      fps: null,
      playUntilMs: null,
    });
  });

  it("setPlayUntil 设置与清除", () => {
    usePlaybackStore.getState().setPlayUntil(3000);
    expect(usePlaybackStore.getState().playUntilMs).toBe(3000);
    usePlaybackStore.getState().setPlayUntil(null);
    expect(usePlaybackStore.getState().playUntilMs).toBeNull();
  });

  it("暂停（setPlaying(false)）清除 playUntilMs——覆盖所有手动暂停路径", () => {
    usePlaybackStore.getState().setPlayUntil(3000);
    usePlaybackStore.getState().setPlaying(true);
    expect(usePlaybackStore.getState().playUntilMs).toBe(3000);
    usePlaybackStore.getState().setPlaying(false);
    expect(usePlaybackStore.getState().playUntilMs).toBeNull();
  });

  it("setFps 记录帧率", () => {
    usePlaybackStore.getState().setFps(29.97);
    expect(usePlaybackStore.getState().fps).toBe(29.97);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test playbackStore`
Expected: FAIL — `fps`/`playUntilMs`/`setPlayUntil`/`setFps` 不存在（类型与运行时均报错）

- [ ] **Step 3: 实现**

`src/stores/playbackStore.ts` 全文替换为：

```typescript
import { create } from "zustand";

interface PlaybackState {
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  selectedCueId: string | null;
  /** 视频帧率；未探测到时为 null（帧步进按 30fps 回退） */
  fps: number | null;
  /** 「播放当前句」的自动停止点；null 表示非片段播放 */
  playUntilMs: number | null;
  setCurrentTime: (ms: number) => void;
  setDuration: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setSelectedCueId: (id: string | null) => void;
  setFps: (fps: number | null) => void;
  setPlayUntil: (ms: number | null) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTimeMs: 0,
  durationMs: 0,
  isPlaying: false,
  selectedCueId: null,
  fps: null,
  playUntilMs: null,
  setCurrentTime: (ms) => set({ currentTimeMs: ms }),
  setDuration: (ms) => set({ durationMs: ms }),
  // 暂停即视为片段播放结束：统一清除 playUntilMs，覆盖空格/按钮/播放结束等所有暂停路径
  setPlaying: (playing) =>
    set(playing ? { isPlaying: true } : { isPlaying: false, playUntilMs: null }),
  setSelectedCueId: (id) => set({ selectedCueId: id }),
  setFps: (fps) => set({ fps }),
  setPlayUntil: (ms) => set({ playUntilMs: ms }),
}));
```

`src/stores/uiStore.ts` 全文替换为：

```typescript
import { create } from "zustand";
import type { WorkflowStep } from "../types";

interface UiState {
  currentStep: WorkflowStep;
  sidebarCollapsed: boolean;
  /** 递增即请求编辑面板聚焦主文本框（Insert 新建字幕后使用） */
  editorFocusNonce: number;
  setStep: (step: WorkflowStep) => void;
  toggleSidebar: () => void;
  requestEditorFocus: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentStep: "welcome",
  sidebarCollapsed: false,
  editorFocusNonce: 0,
  setStep: (step) => set({ currentStep: step }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  requestEditorFocus: () =>
    set((state) => ({ editorFocusNonce: state.editorFocusNonce + 1 })),
}));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test playbackStore`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit（需用户授权，见页首注记）**

```bash
git add src/stores/playbackStore.ts src/stores/uiStore.ts src/stores/playbackStore.test.ts
git commit -m "feat(stores): add fps, playUntil and editor focus request state"
```

---

### Task 5: 动作层与分发器 `useEditorHotkeys`

**Files:**
- Create: `src/hooks/useEditorHotkeys.ts`
- Test: `src/hooks/useEditorHotkeys.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `src/hooks/useEditorHotkeys.test.ts`（zustand store 可在 node 环境直接 `setState`/`getState`，无需渲染组件）：

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEditorActions } from "./useEditorHotkeys";
import { useProjectStore } from "../stores/projectStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useUiStore } from "../stores/uiStore";
import type { SubtitleCue } from "../types";

function cue(id: string, startMs: number, endMs: number): SubtitleCue {
  return { id, startMs, endMs, primaryText: id, style: "Primary", layer: 0 };
}

const CUES = [cue("a", 0, 1000), cue("b", 2000, 3000), cue("c", 5000, 6000)];

function makeActions() {
  return buildEditorActions({ onSave: vi.fn(), onToggleHelp: vi.fn() });
}

beforeEach(() => {
  useProjectStore.setState({
    cues: CUES,
    isDirty: false,
    history: { past: [], future: [] },
  });
  usePlaybackStore.setState({
    currentTimeMs: 0,
    durationMs: 60000,
    isPlaying: false,
    selectedCueId: null,
    fps: 25,
    playUntilMs: null,
  });
  useUiStore.setState({ editorFocusNonce: 0 });
});

describe("导航动作", () => {
  it("select-next 选中下一条并 seek 到起点、中断片段播放", () => {
    usePlaybackStore.setState({ selectedCueId: "a", playUntilMs: 9000 });
    makeActions()["select-next"]!();
    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueId).toBe("b");
    expect(pb.currentTimeMs).toBe(2000);
    expect(pb.playUntilMs).toBeNull();
  });

  it("select-first / select-last / 翻页", () => {
    usePlaybackStore.setState({ selectedCueId: "b" });
    const actions = makeActions();
    actions["select-last"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("c");
    actions["select-first"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("a");
    actions["select-page-down"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("c"); // +10 越界收末条
  });
});

describe("播放头动作", () => {
  it("frame-next 按 25fps 前进到下一帧中心", () => {
    makeActions()["frame-next"]!();
    expect(usePlaybackStore.getState().currentTimeMs).toBeCloseTo(60);
  });

  it("boundary-next 跳到下一个字幕边界", () => {
    usePlaybackStore.setState({ currentTimeMs: 500 });
    makeActions()["boundary-next"]!();
    expect(usePlaybackStore.getState().currentTimeMs).toBe(1000);
  });

  it("boundary-prev 无边界时不动", () => {
    usePlaybackStore.setState({ currentTimeMs: 0 });
    makeActions()["boundary-prev"]!();
    expect(usePlaybackStore.getState().currentTimeMs).toBe(0);
  });

  it("toggle-play 切换播放状态", () => {
    const actions = makeActions();
    actions["toggle-play"]!();
    expect(usePlaybackStore.getState().isPlaying).toBe(true);
    actions["toggle-play"]!();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });

  it("play-segment 从选中 cue 起点播放到终点；再按中断", () => {
    usePlaybackStore.setState({ selectedCueId: "b", currentTimeMs: 0 });
    const actions = makeActions();
    actions["play-segment"]!();
    let pb = usePlaybackStore.getState();
    expect(pb.currentTimeMs).toBe(2000);
    expect(pb.playUntilMs).toBe(3000);
    expect(pb.isPlaying).toBe(true);
    actions["play-segment"]!();
    pb = usePlaybackStore.getState();
    expect(pb.isPlaying).toBe(false);
    expect(pb.playUntilMs).toBeNull();
  });

  it("play-segment 无选中时 no-op", () => {
    makeActions()["play-segment"]!();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });
});

describe("打点动作", () => {
  it("stamp-start / stamp-end 写入选中 cue（取整）", () => {
    usePlaybackStore.setState({ selectedCueId: "b", currentTimeMs: 2500.6 });
    const actions = makeActions();
    actions["stamp-start"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "b")?.startMs).toBe(2501);
    usePlaybackStore.setState({ currentTimeMs: 3500.2 });
    actions["stamp-end"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "b")?.endMs).toBe(3500);
  });

  it("无选中时 no-op", () => {
    makeActions()["stamp-start"]!();
    expect(useProjectStore.getState().cues).toEqual(CUES);
  });
});

describe("编辑动作", () => {
  it("new-cue 在播放头新建、选中并请求聚焦", () => {
    usePlaybackStore.setState({ currentTimeMs: 10000 });
    makeActions()["new-cue"]!();
    const cues = useProjectStore.getState().cues;
    expect(cues).toHaveLength(4);
    const created = cues.find((c) => c.startMs === 10000)!;
    expect(created.primaryText).toBe("新建字幕");
    expect(usePlaybackStore.getState().selectedCueId).toBe(created.id);
    expect(useUiStore.getState().editorFocusNonce).toBe(1);
  });

  it("delete-cue 删除选中并顺延选中下一条（按原索引）", () => {
    usePlaybackStore.setState({ selectedCueId: "b" });
    makeActions()["delete-cue"]!();
    expect(useProjectStore.getState().cues.map((c) => c.id)).toEqual(["a", "c"]);
    expect(usePlaybackStore.getState().selectedCueId).toBe("c");
  });

  it("delete-cue 删除最后一条后选中前一条；删空后为 null", () => {
    usePlaybackStore.setState({ selectedCueId: "c" });
    const actions = makeActions();
    actions["delete-cue"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("b");
    useProjectStore.setState({ cues: [cue("only", 0, 1000)] });
    usePlaybackStore.setState({ selectedCueId: "only" });
    actions["delete-cue"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBeNull();
  });
});

describe("系统动作", () => {
  it("save / toggle-help 走回调；undo/redo 走 projectStore", () => {
    const onSave = vi.fn();
    const onToggleHelp = vi.fn();
    const actions = buildEditorActions({ onSave, onToggleHelp });
    actions["save"]!();
    expect(onSave).toHaveBeenCalledOnce();
    actions["toggle-help"]!();
    expect(onToggleHelp).toHaveBeenCalledOnce();

    useProjectStore.getState().updateCue("a", { primaryText: "changed" });
    actions["undo"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "a")?.primaryText).toBe("a");
    actions["redo"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "a")?.primaryText).toBe("changed");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test useEditorHotkeys`
Expected: FAIL — `Cannot find module './useEditorHotkeys'`

- [ ] **Step 3: 实现**

创建 `src/hooks/useEditorHotkeys.ts`：

```typescript
import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useUiStore } from "../stores/uiStore";
import { findHotkey, type EditorActionId } from "../components/editor/hotkeys";
import {
  createCueAtPlayhead,
  findSubtitleBoundary,
  frameStepTarget,
  selectCueByOffset,
} from "../services/editorActions";
import type { SubtitleCue } from "../types";

const FAST_JUMP_FRAMES = 10;
const PAGE_JUMP_CUES = 10;

export interface EditorHotkeyOptions {
  onSave: () => void;
  onToggleHelp: () => void;
}

/** 选中指定 cue 并 seek 到起点；用户主动切换会中断「播放当前句」。 */
function selectAndSeek(cue: SubtitleCue | null) {
  if (!cue) return;
  const pb = usePlaybackStore.getState();
  pb.setSelectedCueId(cue.id);
  pb.setCurrentTime(cue.startMs);
  pb.setPlayUntil(null);
}

/**
 * actionId → 动作实现。通过 zustand getState 取实时状态，无闭包过期问题；
 * 独立导出便于在 node 环境直接测试。
 */
export function buildEditorActions(
  options: EditorHotkeyOptions,
): Partial<Record<EditorActionId, () => void>> {
  const nav = (offset: number) => {
    const { cues } = useProjectStore.getState();
    const { selectedCueId } = usePlaybackStore.getState();
    selectAndSeek(selectCueByOffset(cues, selectedCueId, offset));
  };

  const frameStep = (frames: number) => {
    const pb = usePlaybackStore.getState();
    pb.setCurrentTime(
      frameStepTarget(pb.currentTimeMs, pb.fps, frames, pb.durationMs),
    );
  };

  const boundaryJump = (direction: -1 | 1) => {
    const { cues } = useProjectStore.getState();
    const pb = usePlaybackStore.getState();
    const target = findSubtitleBoundary(cues, pb.currentTimeMs, direction);
    if (target !== null) pb.setCurrentTime(target);
  };

  const stamp = (field: "startMs" | "endMs") => {
    const { selectedCueId, currentTimeMs } = usePlaybackStore.getState();
    if (!selectedCueId) return;
    useProjectStore
      .getState()
      .updateCue(selectedCueId, { [field]: Math.round(currentTimeMs) });
  };

  const playSegment = () => {
    const pb = usePlaybackStore.getState();
    if (pb.isPlaying && pb.playUntilMs !== null) {
      pb.setPlaying(false); // setPlaying(false) 内清除 playUntilMs
      return;
    }
    const cue = useProjectStore
      .getState()
      .cues.find((c) => c.id === pb.selectedCueId);
    if (!cue) return;
    pb.setCurrentTime(cue.startMs);
    pb.setPlayUntil(cue.endMs);
    pb.setPlaying(true);
  };

  const newCue = () => {
    const pb = usePlaybackStore.getState();
    const created = createCueAtPlayhead(Math.round(pb.currentTimeMs));
    useProjectStore.getState().addCue(created);
    pb.setSelectedCueId(created.id);
    pb.setPlayUntil(null);
    useUiStore.getState().requestEditorFocus();
  };

  const deleteCue = () => {
    const pb = usePlaybackStore.getState();
    if (!pb.selectedCueId) return;
    const before = useProjectStore.getState().cues;
    const idx = before.findIndex((c) => c.id === pb.selectedCueId);
    if (idx < 0) return;
    useProjectStore.getState().deleteCue(pb.selectedCueId);
    const remaining = useProjectStore.getState().cues;
    const next = remaining[Math.min(idx, remaining.length - 1)] ?? null;
    pb.setSelectedCueId(next ? next.id : null);
  };

  return {
    "select-prev": () => nav(-1),
    "select-next": () => nav(1),
    "select-first": () => nav(-Infinity),
    "select-last": () => nav(Infinity),
    "select-page-up": () => nav(-PAGE_JUMP_CUES),
    "select-page-down": () => nav(PAGE_JUMP_CUES),
    "toggle-play": () => {
      const pb = usePlaybackStore.getState();
      pb.setPlaying(!pb.isPlaying);
    },
    "frame-prev": () => frameStep(-1),
    "frame-next": () => frameStep(1),
    "frame-fast-prev": () => frameStep(-FAST_JUMP_FRAMES),
    "frame-fast-next": () => frameStep(FAST_JUMP_FRAMES),
    "boundary-prev": () => boundaryJump(-1),
    "boundary-next": () => boundaryJump(1),
    "play-segment": playSegment,
    "stamp-start": () => stamp("startMs"),
    "stamp-end": () => stamp("endMs"),
    "new-cue": newCue,
    "delete-cue": deleteCue,
    save: () => options.onSave(),
    undo: () => useProjectStore.getState().undo(),
    redo: () => useProjectStore.getState().redo(),
    "toggle-help": () => options.onToggleHelp(),
  };
}

/** 编辑页快捷键分发器：单一 window keydown 监听，卸载时移除。 */
export function useEditorHotkeys(options: EditorHotkeyOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const actions = buildEditorActions({
      onSave: () => optionsRef.current.onSave(),
      onToggleHelp: () => optionsRef.current.onToggleHelp(),
    });
    const onKeyDown = (e: KeyboardEvent) => {
      const def = findHotkey(e);
      if (!def) return;
      e.preventDefault();
      actions[def.action]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test useEditorHotkeys`
Expected: PASS（5 个 describe 全绿）

- [ ] **Step 5: 全量测试防回归**

Run: `pnpm test`
Expected: 全部通过

- [ ] **Step 6: Commit（需用户授权，见页首注记）**

```bash
git add src/hooks/useEditorHotkeys.ts src/hooks/useEditorHotkeys.test.ts
git commit -m "feat(editor): add hotkey action layer and dispatcher hook"
```

---

### Task 6: EditorView / SubtitleList / PlaybackControls 接入

**Files:**
- Modify: `src/components/editor/EditorView.tsx`（移除旧快捷键 effect :29-48，接入 hook）
- Modify: `src/components/editor/SubtitleList.tsx`（点击清除 playUntil）
- Modify: `src/components/player/PlaybackControls.tsx`（title 标注）

- [ ] **Step 1: EditorView 接入分发器**

修改 `src/components/editor/EditorView.tsx`：

1）import 区新增：

```typescript
import { useState } from "react";
import { useEditorHotkeys } from "../../hooks/useEditorHotkeys";
```

（`useEffect` import 如不再被使用则移除。）

2）删除整个「快捷键支持」`useEffect`（原 :29-48）。

3）在 `handleSave` 定义之后加入（`handleSave` 用函数声明或将 hook 调用移到其后，避免暂时性死区；`handleSave` 是 `const`，故 hook 调用放在其定义之后）：

```typescript
  const [helpOpen, setHelpOpen] = useState(false);

  useEditorHotkeys({
    onSave: handleSave,
    onToggleHelp: () => setHelpOpen((v) => !v),
  });
```

注：`helpOpen` 状态本任务先接入，浮层组件在 Task 8 渲染；本任务 `helpOpen` 暂未消费，为通过 tsc 的 `noUnusedLocals`，先在 JSX 根部临时消费：

```tsx
      {/* 键位速查浮层（Task 8 实现组件后替换） */}
      {helpOpen && null}
```

- [ ] **Step 2: SubtitleList 点击中断片段播放**

修改 `src/components/editor/SubtitleList.tsx`：

```typescript
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);

  const handleCueClick = (cue: SubtitleCue) => {
    setSelectedCueId(cue.id);
    setCurrentTime(cue.startMs);
    setPlayUntil(null);
  };
```

- [ ] **Step 3: PlaybackControls title 标注**

修改 `src/components/player/PlaybackControls.tsx` 中三处 title：

```typescript
        title={isPlaying ? "暂停（空格）" : "播放（空格）"}
```

```typescript
          title="撤销 (Ctrl+Z)"
```
改为
```typescript
          title="撤销（Ctrl+Z）"
```

```typescript
          title="重做 (Ctrl+Y)"
```
改为
```typescript
          title="重做（Ctrl+Y / Ctrl+Shift+Z）"
```

- [ ] **Step 4: 构建与全量测试验证**

Run: `pnpm build && pnpm test`
Expected: tsc 无错误、测试全过

- [ ] **Step 5: 手测冒烟（`pnpm tauri dev` 打开任一项目进入编辑页）**

- 框外按 `↑`/`↓`：选中切换、列表滚动跟随、视频 seek 到起点
- 框外按 `空格`：播放/暂停；`←`/`→` 逐帧、`Alt+←/→` 快跳、`Ctrl+←/→` 边界跳
- 编辑框内打字、按 `空格`/`↑↓`：正常输入不触发全局动作
- 编辑框内 `Ctrl+Z`：只撤销文本输入，不回滚字幕列表
- `Ctrl+3`/`Ctrl+4` 在编辑框内外都可打点
- `Insert` 新建、`Delete` 删除并顺延选中

- [ ] **Step 6: Commit（需用户授权，见页首注记）**

```bash
git add src/components/editor/EditorView.tsx src/components/editor/SubtitleList.tsx src/components/player/PlaybackControls.tsx
git commit -m "feat(editor): wire hotkey dispatcher into editor view"
```

---

### Task 7: SubtitleEditor 草稿模型与 Enter/Esc/追加行

**Files:**
- Modify: `src/components/editor/SubtitleEditor.tsx`
- Test: `tests/SubtitleEditorBehavior.test.ts`（源码断言，沿用 `tests/BurnView.test.ts` 风格）

- [ ] **Step 1: 写失败的测试**

创建 `tests/SubtitleEditorBehavior.test.ts`：

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/SubtitleEditor.tsx", import.meta.url),
  ),
  "utf8",
);

describe("SubtitleEditor 快捷键行为约束", () => {
  it("IME 组词保护：Enter 处理前检查 isComposing", () => {
    expect(source).toContain("isComposing");
  });

  it("Esc 放弃草稿：blur 前置守卫避免 onBlur 重复提交", () => {
    expect(source).toContain("escapingRef");
  });

  it("Enter 提交后走 nextAfterCommit 决定去向（含最后一条追加）", () => {
    expect(source).toContain("nextAfterCommit");
    expect(source).toContain("appendCueAfter");
  });

  it("文本草稿仅随 id/store 文本变化重置；时间字段跟随 store 值", () => {
    expect(source).toContain("selectedCue?.id");
    expect(source).toContain("selectedCue?.startMs");
    expect(source).toContain("selectedCue?.endMs");
  });

  it("响应 Insert 新建后的聚焦请求", () => {
    expect(source).toContain("editorFocusNonce");
  });

  it("删除按钮仍保留确认（二期 F 统一替换 toast）", () => {
    expect(source).toContain("confirm(");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test SubtitleEditorBehavior`
Expected: FAIL（`escapingRef`、`nextAfterCommit` 等断言不满足）

- [ ] **Step 3: 实现——`src/components/editor/SubtitleEditor.tsx` 全文替换**

```tsx
import { useEffect, useRef, useState } from "react";
import {
  formatInlineCueText,
  getCueDisplay,
  splitInlineCueText,
} from "@hikaru/ass-core";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useUiStore } from "../../stores/uiStore";
import {
  appendCueAfter,
  createCueAtPlayhead,
  nextAfterCommit,
} from "../../services/editorActions";
import type { SubtitleCue } from "../../types";

function formatTimeInput(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function parseTimeInput(timeStr: string): number {
  const match = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return 0;

  const [, hours, minutes, seconds, centiseconds] = match;
  return (
    parseInt(hours) * 3600000 +
    parseInt(minutes) * 60000 +
    parseInt(seconds) * 1000 +
    parseInt(centiseconds) * 10
  );
}

export function SubtitleEditor() {
  const cues = useProjectStore((s) => s.cues);
  const updateCue = useProjectStore((s) => s.updateCue);
  const addCue = useProjectStore((s) => s.addCue);
  const deleteCue = useProjectStore((s) => s.deleteCue);
  const mergeMode = useSubtitleMergeMode();

  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);
  const editorFocusNonce = useUiStore((s) => s.editorFocusNonce);

  const selectedCue = cues.find((c) => c.id === selectedCueId);

  const [inlineText, setInlineText] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  /** Esc 放弃草稿时置位，跳过随后 blur 触发的提交 */
  const escapingRef = useRef(false);
  const mainTextRef = useRef<HTMLTextAreaElement>(null);

  const useInlineEditor =
    mergeMode === "inline" &&
    !!selectedCue &&
    !!formatInlineCueText(selectedCue);

  // 文本草稿：仅在切换字幕或 store 文本变化（提交/撤销/翻译）时重置。
  // 打点只改时间不触发本 effect，正在输入的草稿不丢。
  useEffect(() => {
    if (!selectedCue) return;

    const display = getCueDisplay(selectedCue, mergeMode);
    if (display.mode === "single") {
      setInlineText(display.text);
      setPrimaryText(selectedCue.primaryText);
      setSecondaryText(selectedCue.secondaryText || "");
    } else {
      setInlineText("");
      setPrimaryText(display.primaryText);
      setSecondaryText(display.secondaryText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCue?.id,
    selectedCue?.primaryText,
    selectedCue?.secondaryText,
    mergeMode,
  ]);

  // 时间字段：实时跟随 store（Ctrl+3/4 打点后即时刷新）。
  useEffect(() => {
    if (!selectedCue) return;
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCue?.id, selectedCue?.startMs, selectedCue?.endMs]);

  // Insert 新建字幕后的聚焦请求
  useEffect(() => {
    if (editorFocusNonce > 0) {
      mainTextRef.current?.focus();
    }
  }, [editorFocusNonce]);

  const commitDraft = () => {
    if (!selectedCue) return;

    if (useInlineEditor) {
      const split = splitInlineCueText(inlineText);
      updateCue(selectedCue.id, {
        primaryText: split?.primaryText ?? inlineText,
        secondaryText: split?.secondaryText,
        startMs: parseTimeInput(startTime),
        endMs: parseTimeInput(endTime),
      });
      return;
    }

    updateCue(selectedCue.id, {
      primaryText,
      secondaryText: secondaryText || undefined,
      startMs: parseTimeInput(startTime),
      endMs: parseTimeInput(endTime),
    });
  };

  const handleBlur = () => {
    if (escapingRef.current) return;
    commitDraft();
  };

  /** Enter：提交并跳下一条；最后一条时追加新行（继承样式，起点接结束时间）。 */
  const commitAndNext = () => {
    if (!selectedCue) return;
    commitDraft();

    const committedCues = useProjectStore.getState().cues;
    const followUp = nextAfterCommit(committedCues, selectedCue.id);
    if (followUp.kind === "none") return;

    setPlayUntil(null);
    if (followUp.kind === "select") {
      setSelectedCueId(followUp.cue.id);
      setCurrentTime(followUp.cue.startMs);
      return;
    }
    const appended = appendCueAfter(followUp.base);
    addCue(appended);
    setSelectedCueId(appended.id);
    setCurrentTime(appended.startMs);
    // 焦点保持在 textarea（元素不卸载），草稿经 id 变化的 effect 重置为空文本
  };

  const resetDraftsFromStore = () => {
    if (!selectedCue) return;
    const display = getCueDisplay(selectedCue, mergeMode);
    if (display.mode === "single") {
      setInlineText(display.text);
      setPrimaryText(selectedCue.primaryText);
      setSecondaryText(selectedCue.secondaryText || "");
    } else {
      setInlineText("");
      setPrimaryText(display.primaryText);
      setSecondaryText(display.secondaryText);
    }
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
  };

  const discardAndBlur = (el: HTMLElement) => {
    escapingRef.current = true;
    resetDraftsFromStore();
    el.blur();
    escapingRef.current = false;
  };

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      discardAndBlur(e.currentTarget);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitAndNext();
    }
    // Shift+Enter 走 textarea 默认换行
  };

  const handleTimeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      discardAndBlur(e.currentTarget);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur(); // blur 提交
    }
  };

  const handleDelete = () => {
    if (!selectedCue) return;
    if (confirm("确定删除该字幕？")) {
      deleteCue(selectedCue.id);
    }
  };

  const handleAdd = () => {
    const newCue: SubtitleCue = createCueAtPlayhead(Math.round(currentTimeMs));
    addCue(newCue);
    setSelectedCueId(newCue.id);
  };

  if (!selectedCue) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
        <p className="text-sm">未选中字幕</p>
        <button
          onClick={handleAdd}
          className="rounded bg-primary px-4 py-2 text-sm text-white hover:bg-primary-hover"
        >
          在当前位置新建字幕
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">编辑字幕</h3>
        <div className="flex gap-2">
          <button
            onClick={handleAdd}
            className="rounded border border-border px-3 py-1 text-xs hover:bg-surface-hover"
            title="新建字幕（Insert）"
          >
            新建
          </button>
          <button
            onClick={handleDelete}
            className="rounded border border-red-500 px-3 py-1 text-xs text-red-500 hover:bg-red-500/10"
            title="删除字幕（Delete）"
          >
            删除
          </button>
        </div>
      </div>

      {/* 时间轴编辑 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-text-muted">开始时间</label>
          <input
            type="text"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleTimeKeyDown}
            placeholder="00:00:00.00"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">结束时间</label>
          <input
            type="text"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleTimeKeyDown}
            placeholder="00:00:00.00"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
          />
        </div>
      </div>

      {/* 字幕编辑 */}
      {useInlineEditor ? (
        <div>
          <label className="mb-1 block text-xs text-text-muted">字幕</label>
          <textarea
            ref={mainTextRef}
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleTextKeyDown}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            rows={5}
          />
        </div>
      ) : secondaryText ? (
        <>
          <div>
            <label className="mb-1 block text-xs text-text-muted">译文</label>
            <textarea
              value={secondaryText}
              onChange={(e) => setSecondaryText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleTextKeyDown}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">原文</label>
            <textarea
              ref={mainTextRef}
              value={primaryText}
              onChange={(e) => setPrimaryText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleTextKeyDown}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              rows={3}
            />
          </div>
        </>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-text-muted">字幕</label>
          <textarea
            ref={mainTextRef}
            value={primaryText}
            onChange={(e) => setPrimaryText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleTextKeyDown}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            rows={5}
          />
        </div>
      )}
    </div>
  );
}
```

要点说明（执行者须知）：

- `handleAdd` 改用 `createCueAtPlayhead`（消除与快捷键 new-cue 的参数重复），并补上新建后自动选中——与 spec「Insert 新增自动选中」一致，按钮路径同步受益。
- 文本草稿 effect 的依赖含 `selectedCue?.primaryText/secondaryText`：撤销/重做/翻译改文本时草稿正确刷新；本地输入未提交前 store 文本不变，草稿不受打点影响。
- `discardAndBlur` 中 `blur()` 同步派发 React onBlur，`escapingRef` 守卫先置位再复位，确保放弃草稿不触发提交。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test SubtitleEditorBehavior`
Expected: PASS（6 个用例）

- [ ] **Step 5: 构建 + 手测**

Run: `pnpm build`
Expected: tsc 无错误

手测（`pnpm tauri dev`）：

- 编辑框输入中按 `Ctrl+3`：时间框刷新为播放位置，正在输入的文本不丢
- `Enter`：提交并跳下一条、seek；日文输入法组词中按 Enter 只确认候选
- 最后一条按 `Enter`：追加空文本新行（起点=上一条终点、2 秒），焦点仍在编辑框
- `Shift+Enter`：换行；`Esc`：放弃修改恢复原值并失焦
- 时间输入框 `Enter`：提交（失焦）

- [ ] **Step 6: Commit（需用户授权，见页首注记）**

```bash
git add src/components/editor/SubtitleEditor.tsx tests/SubtitleEditorBehavior.test.ts
git commit -m "feat(editor): draft model rework with Enter commit flow and Esc discard"
```

---

### Task 8: VideoPlayer 片段自动停与 fps 获取 + 速查浮层

**Files:**
- Modify: `src/components/player/VideoPlayer.tsx`
- Create: `src/components/editor/HotkeyHelpOverlay.tsx`
- Modify: `src/components/editor/EditorView.tsx`（渲染浮层）
- Test: `src/components/editor/HotkeyHelpOverlay.test.ts`

- [ ] **Step 1: 写失败的测试（速查浮层分组函数）**

创建 `src/components/editor/HotkeyHelpOverlay.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { groupHotkeysByCategory } from "./HotkeyHelpOverlay";
import { EDITOR_HOTKEYS } from "./hotkeys";

describe("groupHotkeysByCategory", () => {
  it("按类别分组且保持键位表顺序", () => {
    const groups = groupHotkeysByCategory(EDITOR_HOTKEYS);
    expect([...groups.keys()]).toEqual(["导航", "播放", "打点", "编辑", "系统"]);
    expect(groups.get("打点")).toHaveLength(2);
  });

  it("handledLocally 条目也展示（Enter/Esc 属于键位表）", () => {
    const groups = groupHotkeysByCategory(EDITOR_HOTKEYS);
    const editLabels = groups.get("编辑")!.map((d) => d.label);
    expect(editLabels).toContain("Enter");
    expect(editLabels).toContain("Esc");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test HotkeyHelpOverlay`
Expected: FAIL — `Cannot find module './HotkeyHelpOverlay'`

- [ ] **Step 3: 实现速查浮层**

创建 `src/components/editor/HotkeyHelpOverlay.tsx`：

```tsx
import { useEffect } from "react";
import { EDITOR_HOTKEYS, type HotkeyDef } from "./hotkeys";

/** 按 category 分组，保持键位表内出现顺序。 */
export function groupHotkeysByCategory(
  defs: HotkeyDef[],
): Map<string, HotkeyDef[]> {
  const groups = new Map<string, HotkeyDef[]>();
  for (const def of defs) {
    const list = groups.get(def.category);
    if (list) {
      list.push(def);
    } else {
      groups.set(def.category, [def]);
    }
  }
  return groups;
}

interface HotkeyHelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function HotkeyHelpOverlay({ open, onClose }: HotkeyHelpOverlayProps) {
  // 浮层打开时 Esc 关闭（编辑框外的 Esc 不在键位表内，此处局部处理）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupHotkeysByCategory(EDITOR_HOTKEYS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[560px] overflow-auto rounded-lg border border-border bg-surface-raised p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">键盘快捷键</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
            title="关闭（Esc）"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        {[...groups.entries()].map(([category, defs]) => (
          <div key={category} className="mb-4 last:mb-0">
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
              {category}
            </h4>
            <div className="space-y-1">
              {defs.map((def) => (
                <div
                  key={`${def.label}-${def.action}`}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="text-text">{def.description}</span>
                  <kbd className="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-text-muted">
                    {def.label}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: EditorView 渲染浮层**

修改 `src/components/editor/EditorView.tsx`：

1）import 新增：

```typescript
import { HotkeyHelpOverlay } from "./HotkeyHelpOverlay";
```

2）将 Task 6 的临时占位 `{helpOpen && null}` 替换为（放在「未保存提示」之后、根 div 收尾前）：

```tsx
      {/* 键位速查浮层（? 呼出） */}
      <HotkeyHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
```

- [ ] **Step 5: VideoPlayer 片段自动停 + fps 获取**

修改 `src/components/player/VideoPlayer.tsx`：

1）import 调整（:7）：

```typescript
import { discoverPreviewFonts, getVideoInfo } from "../../services/tauri";
```

2）新增 fps 探测 effect（放在「监听转码进度」effect 之后、视频加载 effect 之前）：

```typescript
  // 探测原片帧率供逐帧步进使用（代理转码不改帧率，始终按原路径探测）
  useEffect(() => {
    if (!videoPath) return;
    const { setFps } = usePlaybackStore.getState();
    setFps(null);
    getVideoInfo(videoPath)
      .then((info) => setFps(info.fps ?? null))
      .catch(() => setFps(null));
  }, [videoPath]);
```

3）`handleTimeUpdate`（现 :241-254）内、`setCurrentTime(ms)` 之后追加片段自动停：

```typescript
      // 「播放当前句」到点自动暂停；pause 事件链会经 setPlaying(false) 清除 playUntilMs
      const { playUntilMs } = usePlaybackStore.getState();
      if (playUntilMs !== null && ms >= playUntilMs) {
        video.pause();
      }
```

- [ ] **Step 6: 测试与构建**

Run: `pnpm test && pnpm build`
Expected: 全部通过、tsc 无错误

- [ ] **Step 7: 手测**

- `?` 呼出速查浮层，五个分组齐全；`Esc`/点击遮罩/关闭按钮均可关闭
- 选中一条字幕按 `R`：从起点播放、到终点自动暂停；播放中再按 `R` 立即停
- 播放中切换选中（`↑↓`/点击列表）：片段播放解除（不会在旧终点意外暂停）
- 换不同帧率视频验证 `←/→` 逐帧步进幅度

- [ ] **Step 8: Commit（需用户授权，见页首注记）**

```bash
git add src/components/player/VideoPlayer.tsx src/components/editor/HotkeyHelpOverlay.tsx src/components/editor/HotkeyHelpOverlay.test.ts src/components/editor/EditorView.tsx
git commit -m "feat(editor): segment playback auto-stop, fps probing and hotkey help overlay"
```

---

### Task 9: 全量验证与文档更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 全量回归**

Run: `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 前端测试全过、tsc 无错误、Rust 测试全过

- [ ] **Step 2: 完整手测清单（`pnpm tauri dev`）**

按键位表逐条验证（重点交叉场景）：

- 日文 IME 在编辑框组词，期间按 Enter / 方向键 / Ctrl+3：仅 IME 行为，无全局动作
- 编辑框内 `Ctrl+Z` 撤文本、框外 `Ctrl+Z` 撤字幕操作；`Delete` 删除后 `Ctrl+Z` 恢复
- `Insert` 新建 → 焦点直接落在编辑框 → 打字 → `Enter` 提交
- 无字幕/未选中状态：各键 no-op 无报错（控制台无异常）
- `Home`/`End`/`PgUp`/`PgDn` 长列表导航 + 列表滚动跟随

- [ ] **Step 3: 更新 README**

`README.md` 待优化列表第 4 项（:28-30）：

```markdown
4. 编辑页功能完善：
   - 快捷键操作（上下切换字幕、时间轴左右移动）
   - 字幕样式可视化编辑（字体、颜色、位置等 GUI，当前需在编辑框手写 ASS 标签）
```

替换为：

```markdown
4. 编辑页字幕样式可视化编辑（字体、颜色、位置等 GUI，当前需在编辑框手写 ASS 标签）
```

「✅ 已实现」列表字幕编辑器条目（:17）在「撤销重做」后补充「+ Aegisub 式快捷键体系（字幕导航、逐帧/边界播放头控制、Ctrl+3/4 对轴打点、Enter 提交跳转、? 键位速查）」。

「核心功能 → 编辑器」小节（:199-206）在 `Ctrl+S` 一行后补充：

```markdown
- Aegisub 式快捷键：`↑/↓` 切换字幕、`←/→` 逐帧、`Alt+←/→` 快跳 10 帧、`Ctrl+←/→` 字幕边界跳转、`R` 播放当前句、`Ctrl+3/4` 打点、`Insert`/`Delete` 增删、`Enter` 提交跳下一条（末条追加）、`Esc` 放弃草稿、`?` 键位速查；编辑框内自动放行文本输入与原生撤销
```

- [ ] **Step 4: 最终确认**

Run: `pnpm test`
Expected: 全部通过

- [ ] **Step 5: Commit（需用户授权，见页首注记）**

```bash
git add README.md
git commit -m "docs: update editor hotkeys progress in README"
```

---

## Spec 覆盖对照

| Spec 要求 | 计划位置 |
|-----------|----------|
| 键位表 v2 全部条目 | Task 3（键位表数据）、Task 5（动作实现）、Task 7（Enter/Esc 本地处理） |
| 焦点感知分发 + Ctrl+Z bug 修复 | Task 3（scope 匹配）、Task 6（移除旧 effect） |
| IME 保护 | Task 3（findHotkey）、Task 7（handleTextKeyDown/handleTimeKeyDown） |
| Rust fps 字段 | Task 1 |
| playbackStore fps/playUntilMs | Task 4 |
| 草稿提交模型改造（行为决策 1） | Task 7 |
| Enter 最后一条追加行（行为决策 2） | Task 2（appendCueAfter/nextAfterCommit）、Task 7 |
| Delete 无 confirm、按钮保留（行为决策 3） | Task 5（delete-cue）、Task 7（handleDelete 保留 confirm） |
| 打点不拦截（行为决策 4） | Task 5（stamp 直接写入） |
| 播放当前句（行为决策 5） | Task 4（setPlaying 清除语义）、Task 5（play-segment）、Task 8（自动停） |
| 帧中心 seek（行为决策 6） | Task 2（frameStepTarget） |
| 空态 no-op（行为决策 7） | Task 2/5 各函数守卫 + 测试 |
| 播放中导航自洽（行为决策 8） | Task 5（selectAndSeek）+ Task 8 手测 |
| Insert 新建参数与自动选中聚焦 | Task 2（createCueAtPlayhead）、Task 5（new-cue）、Task 7（聚焦响应） |
| 速查浮层 | Task 8 |
| 边界情况（fps null、边界容差、Alt+← 历史后退） | Task 2（回退与容差）、Task 5 分发器 preventDefault |
| 测试策略三类 | Task 2/3/4/5（逻辑单测）、Task 7（源码断言）、Task 6/8/9（构建+手测） |
