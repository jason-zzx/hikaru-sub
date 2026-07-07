# File-Centered Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hidden-project workflow with runtime `VideoSession` objects, visible per-video subtitle files, and cache-backed intermediate files.

**Architecture:** The backend prepares a `VideoSession` by deriving canonical subtitle paths beside the video and intermediate paths under Tauri's app cache directory. The frontend stores the current session plus an active subtitle target, and workflow pages read current app settings at operation time instead of storing per-video configuration.

**Tech Stack:** Tauri 2 + Rust, React 19 + TypeScript, Zustand, Vitest, pnpm workspace, `@hikaru/ass-core`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener`.

## Global Constraints

- Use `pnpm`, not `npm` or `yarn`.
- User-visible app/product text must use `Hikaru Sub`; machine identifiers may use `hikaru-sub`.
- User-facing UI strings are Simplified Chinese.
- New sessions keep `sourceLang: "ja"` and must not reintroduce source language selection.
- Do not create or read the old hidden project directory.
- Do not preserve old hidden-project compatibility or migration.
- Runtime state uses `VideoSession`, not the old project metadata type.
- Transcribed subtitle output is exactly `<video-stem>.transcribed.ass`.
- Translated subtitle output is exactly `<video-stem>.translated.ass`.
- Do not derive translated output by replacing `.ass` on the transcribed path.
- Extracted audio, ASR recovery snapshots, and burn input ASS live under app cache.
- Delete `audio.wav` after a successful transcription save.
- Editor save target is the active subtitle path, not the presence of `secondaryText`.
- Do not run `git commit`, `git push`, `git merge`, `git rebase`, or reset commands unless the user separately and explicitly asks for that Git operation.
- Each task ends with a diff/status checkpoint instead of a commit.

---

## File Structure

- Modify `src-tauri/src/project.rs`: replace persisted project creation/opening with `VideoSession` path derivation, `prepare_video_session`, and restricted cached-audio cleanup.
- Modify `src-tauri/src/lib.rs`: register `prepare_video_session` and cached-audio cleanup; remove old project open/create registrations.
- Modify `src-tauri/src/ass.rs`: make ASS writes require an existing parent directory.
- Modify `src-tauri/src/asr.rs`: require explicit output ASS paths before starting ASR and update recovery-path tests.
- Modify `asr-service/jobs.py` and `src-tauri/resources/asr-service/jobs.py`: remove default ASS output fallback.
- Modify `asr-service/tests/test_jobs.py`: cover explicit output and no-output behavior.
- Modify `src/types/index.ts`: add `VideoSession` and active subtitle types; remove old project metadata type usage.
- Modify `src/services/tauri.ts`: expose `prepareVideoSession`, canonical path helpers, and cached-audio cleanup.
- Modify `src/stores/projectStore.ts` and `src/stores/projectStore.test.ts`: store `session`, `activeSubtitlePath`, and `activeSubtitleKind`.
- Modify `src/components/workflow/ImportView.tsx`: select video, prepare session, load existing visible subtitle outputs, remove directory-based project flow.
- Modify `src/components/workflow/DownloadView.tsx`: after download, prepare an empty video session and do not load existing subtitles.
- Modify `src/components/workflow/TranscribeView.tsx`: read current settings, save ASR output to `transcribedAssPath`, activate that subtitle, and delete cached audio.
- Modify `src/components/workflow/TranslateView.tsx`: read transcribed ASS and save translated ASS to `translatedAssPath`, then activate that subtitle.
- Modify `src/components/editor/EditorView.tsx`: save to active subtitle path and expose open/reveal subtitle actions.
- Modify `src/components/workflow/BurnView.tsx`: write `burn.input.ass` to cache workspace via `burnAssPath`.
- Modify source-guard tests under `tests/` and add focused tests for the new workflow.
- Modify `README.md`, `AGENTS.md`, ASR sidecar README files, and any related docs that describe the old project model.

---

## Task 1: Backend VideoSession Paths

**Files:**
- Modify: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/project.rs`

**Interfaces:**
- Produces command: `project::prepare_video_session(app: tauri::AppHandle, video_path: String) -> Result<VideoSession, String>`
- Produces fields serialized as camelCase:
  - `videoPath: string`
  - `workspacePath: string`
  - `audioPath: string`
  - `transcribedAssPath: string`
  - `translatedAssPath: string`
  - `burnAssPath: string`
  - `sourceLang: "ja"`
- Produces helper: `build_video_session(video_path: &Path, cache_root: &Path) -> Result<VideoSession, String>`

- [ ] **Step 1: Replace old project-path tests with failing session-path tests**

In `src-tauri/src/project.rs`, replace the old project-directory test module with:

```rust
#[test]
fn build_video_session_derives_visible_subtitle_paths_and_cache_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let video_path = temp.path().join("episode.01.mp4");
    fs::write(&video_path, b"video").unwrap();

    let session = build_video_session(&video_path, cache.path()).unwrap();

    assert_eq!(
        session.video_path,
        video_path.canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(
        session.transcribed_ass_path,
        temp.path()
            .join("episode.01.transcribed.ass")
            .to_string_lossy()
    );
    assert_eq!(
        session.translated_ass_path,
        temp.path()
            .join("episode.01.translated.ass")
            .to_string_lossy()
    );
    assert!(session
        .audio_path
        .ends_with(&format!("{}audio.wav", std::path::MAIN_SEPARATOR)));
    assert!(session
        .burn_ass_path
        .ends_with(&format!("{}burn.input.ass", std::path::MAIN_SEPARATOR)));
    assert!(Path::new(&session.workspace_path).starts_with(cache.path()));

    let legacy_hidden_dir = format!(".{}", "hikaru");
    assert!(!temp.path().join(legacy_hidden_dir).exists());
}

#[test]
fn build_video_session_uses_distinct_cache_workspace_for_same_file_name() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let dir_a = root.path().join("a");
    let dir_b = root.path().join("b");
    fs::create_dir_all(&dir_a).unwrap();
    fs::create_dir_all(&dir_b).unwrap();
    let video_a = dir_a.join("episode.mp4");
    let video_b = dir_b.join("episode.mp4");
    fs::write(&video_a, b"a").unwrap();
    fs::write(&video_b, b"b").unwrap();

    let session_a = build_video_session(&video_a, cache.path()).unwrap();
    let session_b = build_video_session(&video_b, cache.path()).unwrap();

    assert_ne!(session_a.workspace_path, session_b.workspace_path);
    assert_eq!(
        session_a.transcribed_ass_path,
        dir_a.join("episode.transcribed.ass").to_string_lossy()
    );
    assert_eq!(
        session_b.transcribed_ass_path,
        dir_b.join("episode.transcribed.ass").to_string_lossy()
    );
}

#[test]
fn build_video_session_uses_canonical_video_path_for_workspace_key() {
    let temp = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let nested = temp.path().join("nested");
    fs::create_dir_all(&nested).unwrap();
    let video_path = nested.join("episode.mp4");
    fs::write(&video_path, b"video").unwrap();

    let direct = build_video_session(&video_path, cache.path()).unwrap();
    let with_parent_segment = nested.join("..").join("nested").join("episode.mp4");
    let normalized = build_video_session(&with_parent_segment, cache.path()).unwrap();

    assert_eq!(direct.video_path, normalized.video_path);
    assert_eq!(direct.workspace_path, normalized.workspace_path);
}
```

- [ ] **Step 2: Run the focused Rust tests and verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml project::tests::build_video_session -- --nocapture
```

Expected: fails because `VideoSession`, `build_video_session`, and the new path fields do not exist yet.

- [ ] **Step 3: Implement `VideoSession` path derivation without writing metadata**

In `src-tauri/src/project.rs`, replace the old persisted project helpers with:

```rust
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSession {
    pub video_path: String,
    pub workspace_path: String,
    pub audio_path: String,
    pub transcribed_ass_path: String,
    pub translated_ass_path: String,
    pub burn_ass_path: String,
    pub source_lang: String,
}

fn video_stem(video_path: &Path) -> Result<String, String> {
    video_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .map(|stem| stem.to_string())
        .ok_or_else(|| "无法解析视频文件名".to_string())
}

fn workspace_key_for_video(video_path: &Path) -> Result<String, String> {
    let canonical = video_path
        .canonicalize()
        .map_err(|e| format!("无法解析视频绝对路径: {e}"))?;
    let normalized = canonical.to_string_lossy().replace('\\', "/");
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

fn build_video_session(video_path: &Path, cache_root: &Path) -> Result<VideoSession, String> {
    if !video_path.is_file() {
        return Err(format!("视频文件不存在: {}", video_path.display()));
    }

    let canonical_video = video_path
        .canonicalize()
        .map_err(|e| format!("无法解析视频绝对路径: {e}"))?;
    let parent = canonical_video
        .parent()
        .ok_or_else(|| "无法解析视频所在目录".to_string())?;
    let stem = video_stem(&canonical_video)?;
    let workspace = cache_root
        .join("workspace")
        .join(workspace_key_for_video(&canonical_video)?);

    Ok(VideoSession {
        video_path: canonical_video.to_string_lossy().into_owned(),
        workspace_path: workspace.to_string_lossy().into_owned(),
        audio_path: workspace.join("audio.wav").to_string_lossy().into_owned(),
        transcribed_ass_path: parent
            .join(format!("{stem}.transcribed.ass"))
            .to_string_lossy()
            .into_owned(),
        translated_ass_path: parent
            .join(format!("{stem}.translated.ass"))
            .to_string_lossy()
            .into_owned(),
        burn_ass_path: workspace.join("burn.input.ass").to_string_lossy().into_owned(),
        source_lang: "ja".into(),
    })
}

#[tauri::command]
pub fn prepare_video_session(
    app: tauri::AppHandle,
    video_path: String,
) -> Result<VideoSession, String> {
    let video = PathBuf::from(&video_path);
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法读取应用缓存目录: {e}"))?;
    let session = build_video_session(&video, &cache_root)?;
    fs::create_dir_all(&session.workspace_path)
        .map_err(|e| format!("无法创建缓存工作目录: {e}"))?;
    Ok(session)
}
```

Keep `path_exists`. Remove old project directory helpers and commands from this module.

- [ ] **Step 4: Update command registration**

In `src-tauri/src/lib.rs`, register:

```rust
project::prepare_video_session,
project::path_exists,
```

Remove the old project create/open registrations.

- [ ] **Step 5: Run focused Rust tests and inspect status**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml project -- --nocapture
git status --short
```

Expected: project tests pass; status shows only intended modified files. Do not commit.

---

## Task 2: Backend File Helpers and ASR Output Contract

**Files:**
- Modify: `src-tauri/src/ass.rs`
- Modify: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/asr.rs`
- Modify: `asr-service/jobs.py`
- Modify: `src-tauri/resources/asr-service/jobs.py`
- Modify: `asr-service/tests/test_jobs.py`
- Test: `src-tauri/src/ass.rs`
- Test: `src-tauri/src/project.rs`
- Test: `src-tauri/src/asr.rs`
- Test: `asr-service/tests/test_jobs.py`

**Interfaces:**
- `save_ass_text` requires the target parent directory to already exist.
- `delete_cached_audio(app, audio_path)` deletes only app-cache workspace `audio.wav` files.
- `start_asr` fails before contacting sidecar if `outputAssPath` is missing or blank.
- Python sidecar writes ASS only when `output_ass_path` is provided.

- [ ] **Step 1: Add failing Rust tests for stricter file behavior**

In `src-tauri/src/ass.rs`, extract the write implementation into a helper and add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_ass_text_requires_existing_parent_directory() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("missing").join("episode.transcribed.ass");

        let err = write_ass_text_to_path(&target, "[Script Info]").unwrap_err();

        assert!(err.contains("ASS 文件目录不存在"));
        assert!(!target.exists());
    }
}
```

In `src-tauri/src/project.rs`, add unit coverage for cached audio path validation:

```rust
#[test]
fn cached_audio_path_must_be_audio_wav_under_workspace() {
    let cache = tempfile::tempdir().unwrap();
    let workspace = cache.path().join("workspace").join("abc");
    fs::create_dir_all(&workspace).unwrap();

    assert!(is_cached_audio_path(cache.path(), &workspace.join("audio.wav")).unwrap());
    assert!(!is_cached_audio_path(cache.path(), &workspace.join("other.wav")).unwrap());
    assert!(!is_cached_audio_path(cache.path(), &cache.path().join("audio.wav")).unwrap());
}
```

In `src-tauri/src/asr.rs`, add:

```rust
#[test]
fn start_asr_args_require_output_ass_path() {
    let args = StartAsrArgs {
        audio_path: "cache/workspace/abc/audio.wav".into(),
        engine: "faster-whisper".into(),
        model: "large-v3".into(),
        device: "auto".into(),
        language: Some("ja".into()),
        output_ass_path: None,
        use_vad: false,
        vad_config: None,
    };

    let err = validate_start_asr_args(&args).unwrap_err();

    assert!(err.contains("缺少转录字幕输出路径"));
}
```

- [ ] **Step 2: Add failing Python sidecar tests**

In `asr-service/tests/test_jobs.py`, change the persistence test to use a visible transcribed output path:

```python
ass_path = Path(tmp) / "episode.transcribed.ass"
```

Add:

```python
def test_completed_job_without_output_path_does_not_write_default_ass(self):
    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp) / "cache" / "workspace" / "abc"
        workspace.mkdir(parents=True)
        audio = workspace / "audio.wav"
        audio.write_bytes(b"fake audio")

        manager = JobManager()
        with patch("jobs.create_engine", return_value=_FakeEngine()):
            job = manager.create(
                audio_path=str(audio),
                engine="parakeet",
                model="nvidia/parakeet-tdt_ctc-0.6b-ja",
                device="auto",
                language="ja",
            )
            snapshot = _wait_for_completion(job)

        self.assertEqual(snapshot["status"], "completed")
        legacy_ass_name = "subtitles" + ".ass"
        self.assertFalse((workspace / legacy_ass_name).exists())
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ass::tests::write_ass_text_requires_existing_parent_directory -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml project::tests::cached_audio_path_must_be_audio_wav_under_workspace -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml asr::tests::start_asr_args_require_output_ass_path -- --nocapture
python -m unittest asr-service.tests.test_jobs.JobPersistenceTests.test_completed_job_without_output_path_does_not_write_default_ass
```

Expected: tests fail until the helpers and ASR validation are implemented.

- [ ] **Step 4: Make ASS writes require an existing parent**

In `src-tauri/src/ass.rs`, implement:

```rust
fn write_ass_text_to_path(path: &Path, ass_text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(format!("ASS 文件目录不存在: {}", parent.display()));
        }
    }
    std::fs::write(path, ass_text).map_err(|e| format!("写入 ASS 文件失败: {}", e))
}
```

Then make `save_ass_text` call this helper.

- [ ] **Step 5: Add restricted cached-audio cleanup**

In `src-tauri/src/project.rs`, implement:

```rust
fn is_cached_audio_path(cache_root: &Path, audio_path: &Path) -> Result<bool, String> {
    if audio_path.file_name().and_then(|name| name.to_str()) != Some("audio.wav") {
        return Ok(false);
    }
    let workspace_root = cache_root.join("workspace");
    let audio_parent = match audio_path.parent() {
        Some(parent) if parent.is_dir() => parent,
        _ => return Ok(false),
    };
    let canonical_workspace_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("无法解析缓存目录: {e}"))?;
    let canonical_audio_parent = audio_parent
        .canonicalize()
        .map_err(|e| format!("无法解析音频缓存目录: {e}"))?;
    Ok(canonical_audio_parent.starts_with(canonical_workspace_root))
}

#[tauri::command]
pub fn delete_cached_audio(app: tauri::AppHandle, audio_path: String) -> Result<bool, String> {
    let path = PathBuf::from(&audio_path);
    if !path.exists() {
        return Ok(false);
    }
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法读取应用缓存目录: {e}"))?;
    if !is_cached_audio_path(&cache_root, &path)? {
        return Err("拒绝删除非会话音频缓存文件".into());
    }
    fs::remove_file(&path).map_err(|e| format!("删除音频缓存失败: {e}"))?;
    Ok(true)
}
```

Register `project::delete_cached_audio` in `src-tauri/src/lib.rs`.

- [ ] **Step 6: Require explicit ASR output paths**

In `src-tauri/src/asr.rs`, add:

```rust
fn validate_start_asr_args(args: &StartAsrArgs) -> Result<(), String> {
    if args
        .output_ass_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err("缺少转录字幕输出路径".into());
    }
    Ok(())
}
```

At the start of `start_asr`, before `ensure_base_url`, call:

```rust
validate_start_asr_args(&args)?;
```

- [ ] **Step 7: Remove Python ASS fallback**

In both `asr-service/jobs.py` and `src-tauri/resources/asr-service/jobs.py`, change `_write_completed_ass` so it returns when no output path exists:

```python
with job._lock:
    if job.status != JobStatus.COMPLETED or not job.segments:
        return
    segments = list(job.segments)
    output_ass_path = job.output_ass_path
if not output_ass_path:
    debug_log("job_ass_save_skipped", jobId=job.id, reason="missing_output_path")
    return
ass_path = Path(output_ass_path)
write_ass_file(ass_path, segments)
```

- [ ] **Step 8: Run backend and Python tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ass::tests project::tests asr::tests -- --nocapture
python -m unittest asr-service.tests.test_jobs
git status --short
```

Expected: tests pass. Do not commit.

---

## Task 3: Frontend VideoSession Types and Store

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/tauri.ts`
- Modify: `src/stores/projectStore.ts`
- Modify: `src/stores/projectStore.test.ts`
- Test: `tests/FileCenteredWorkflow.test.ts`

**Interfaces:**
- Produces `VideoSession`.
- Produces `ActiveSubtitleKind`.
- Produces service function `prepareVideoSession(videoPath: string): Promise<VideoSession>`.
- Produces helper functions:
  - `transcribedAssPath(session: VideoSession): string`
  - `translatedAssPath(session: VideoSession): string`
  - `workspaceDirFromSession(session: VideoSession): string`
  - `deleteCachedAudio(audioPath: string): Promise<boolean>`
- Store keeps `session`, `activeSubtitlePath`, and `activeSubtitleKind`.

- [ ] **Step 1: Add source guards for runtime session naming**

Create or update `tests/FileCenteredWorkflow.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const typesSource = readFileSync(
  fileURLToPath(new URL("../src/types/index.ts", import.meta.url)),
  "utf8",
);
const servicesSource = readFileSync(
  fileURLToPath(new URL("../src/services/tauri.ts", import.meta.url)),
  "utf8",
);
const storeSource = readFileSync(
  fileURLToPath(new URL("../src/stores/projectStore.ts", import.meta.url)),
  "utf8",
);

describe("file-centered session model", () => {
  it("uses VideoSession instead of persisted project metadata", () => {
    expect(typesSource).toContain("interface VideoSession");
    expect(typesSource).toContain("transcribedAssPath: string");
    expect(typesSource).toContain("translatedAssPath: string");
    expect(typesSource).not.toContain("interface " + "Project" + "Meta");
    expect(servicesSource).toContain("prepareVideoSession");
    expect(servicesSource).toContain('"prepare_video_session"');
    expect(servicesSource).not.toContain("create" + "Project");
    expect(servicesSource).not.toContain("open" + "Project");
    expect(storeSource).toContain("activeSubtitlePath");
    expect(storeSource).toContain("activeSubtitleKind");
  });
});
```

- [ ] **Step 2: Run the failing frontend test**

Run:

```bash
pnpm test -- tests/FileCenteredWorkflow.test.ts
```

Expected: fails because the frontend still uses old project metadata and service helpers.

- [ ] **Step 3: Update TypeScript types**

In `src/types/index.ts`, replace the old project metadata interface with:

```ts
export type ActiveSubtitleKind = "transcribed" | "translated";

export interface VideoSession {
  videoPath: string;
  workspacePath: string;
  audioPath: string;
  transcribedAssPath: string;
  translatedAssPath: string;
  burnAssPath: string;
  sourceLang: "ja";
}
```

Remove `AsrConfig` and `TranslationConfig` if no other code uses them after the session migration.

- [ ] **Step 4: Update Tauri service helpers**

In `src/services/tauri.ts`, remove old project helpers and add:

```ts
export async function prepareVideoSession(videoPath: string): Promise<VideoSession> {
  return invoke<VideoSession>("prepare_video_session", { videoPath });
}

export function transcribedAssPath(session: VideoSession): string {
  return session.transcribedAssPath;
}

export function translatedAssPath(session: VideoSession): string {
  return session.translatedAssPath;
}

export function workspaceDirFromSession(session: VideoSession): string {
  return session.workspacePath;
}

export async function deleteCachedAudio(audioPath: string): Promise<boolean> {
  return invoke<boolean>("delete_cached_audio", { audioPath });
}
```

- [ ] **Step 5: Update store state around sessions and active subtitles**

In `src/stores/projectStore.ts`, keep the file name to avoid broad import churn, but update the state shape:

```ts
interface ProjectState {
  session: VideoSession | null;
  activeSubtitlePath: string | null;
  activeSubtitleKind: ActiveSubtitleKind | null;
  videoPath: string | null;
  cues: SubtitleCue[];
  assScriptInfo: AssScriptInfo | null;
  assStyles: AssStyle[];
  isDirty: boolean;
  history: HistoryState;
  setSession: (session: VideoSession) => void;
  setActiveSubtitle: (
    kind: ActiveSubtitleKind | null,
    path: string | null,
  ) => void;
  clearSession: () => void;
  loadAssDocument: (
    doc: AssDocument,
    active?: { kind: ActiveSubtitleKind; path: string },
  ) => void;
  // keep existing cue/style/history methods
}
```

Implement:

```ts
setSession: (session) =>
  set({
    session,
    activeSubtitlePath: null,
    activeSubtitleKind: null,
    videoPath: session.videoPath,
    cues: [],
    ...emptyAssState,
    isDirty: false,
    history: { past: [], future: [] },
  }),

setActiveSubtitle: (kind, path) =>
  set({
    activeSubtitleKind: kind,
    activeSubtitlePath: path,
  }),

clearSession: () =>
  set({
    session: null,
    activeSubtitlePath: null,
    activeSubtitleKind: null,
    videoPath: null,
    cues: [],
    ...emptyAssState,
    isDirty: false,
    history: { past: [], future: [] },
  }),

loadAssDocument: (doc, active) =>
  set({
    cues: doc.cues,
    assScriptInfo: doc.scriptInfo,
    assStyles: doc.styles,
    activeSubtitleKind: active?.kind ?? get().activeSubtitleKind,
    activeSubtitlePath: active?.path ?? get().activeSubtitlePath,
    isDirty: false,
    history: { past: [], future: [] },
  }),
```

- [ ] **Step 6: Add store tests**

In `src/stores/projectStore.test.ts`, add:

```ts
it("stores runtime video sessions and active subtitle paths", () => {
  useProjectStore.getState().setSession({
    videoPath: "C:/video/episode.mp4",
    workspacePath: "C:/cache/workspace/hash",
    audioPath: "C:/cache/workspace/hash/audio.wav",
    transcribedAssPath: "C:/video/episode.transcribed.ass",
    translatedAssPath: "C:/video/episode.translated.ass",
    burnAssPath: "C:/cache/workspace/hash/burn.input.ass",
    sourceLang: "ja",
  });

  useProjectStore
    .getState()
    .setActiveSubtitle("translated", "C:/video/episode.translated.ass");

  const state = useProjectStore.getState();
  expect(state.session?.workspacePath).toBe("C:/cache/workspace/hash");
  expect(state.activeSubtitleKind).toBe("translated");
  expect(state.activeSubtitlePath).toBe("C:/video/episode.translated.ass");
});
```

Update reset state in existing tests to use `session`, `activeSubtitlePath`, and `activeSubtitleKind`.

- [ ] **Step 7: Run focused frontend tests**

Run:

```bash
pnpm test -- tests/FileCenteredWorkflow.test.ts src/stores/projectStore.test.ts
git status --short
```

Expected: tests pass. Do not commit.

---

## Task 4: Import and Download Session Flow

**Files:**
- Modify: `src/components/workflow/ImportView.tsx`
- Modify: `src/components/workflow/DownloadView.tsx`
- Modify: `tests/FileCenteredWorkflow.test.ts`

**Behavior:**
- Import prepares a session and tries to load existing translated, then transcribed subtitles.
- If an existing subtitle cannot be parsed, treat that stage as incomplete and continue.
- Download completion prepares an empty session and does not load existing subtitles.
- Directory-based project opening is removed.

- [ ] **Step 1: Add failing source guards**

Extend `tests/FileCenteredWorkflow.test.ts`:

```ts
const importSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/ImportView.tsx", import.meta.url)),
  "utf8",
);
const downloadSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/DownloadView.tsx", import.meta.url)),
  "utf8",
);

describe("file-centered import and download flow", () => {
  it("prepares video sessions without project directory flows", () => {
    const oldHiddenDir = ".hi" + "karu";
    expect(importSource).toContain("prepareVideoSession");
    expect(importSource).toContain("setSession");
    expect(importSource).toContain("translatedAssPath(session)");
    expect(importSource).toContain("transcribedAssPath(session)");
    expect(importSource).not.toContain("pickDirectory");
    expect(importSource).not.toContain(oldHiddenDir);
    expect(downloadSource).toContain("prepareVideoSession");
    expect(downloadSource).toContain("setSession");
  });

  it("download prepares an empty session without auto-loading subtitles", () => {
    expect(downloadSource).not.toContain("loadAssDocument");
    expect(downloadSource).toContain("完成后可打开并继续转录");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm test -- tests/FileCenteredWorkflow.test.ts
```

Expected: fails while import/download still use old project helpers.

- [ ] **Step 3: Update ImportView**

In `src/components/workflow/ImportView.tsx`:

- import `prepareVideoSession`, `transcribedAssPath`, `translatedAssPath`, `pathExists`, and `loadAssText`.
- remove directory picker and old project open/create imports.
- replace session creation with:

```ts
const session = await prepareVideoSession(videoPath);
setSession(session);

const { loadAssDocument } = useProjectStore.getState();
const translatedPath = translatedAssPath(session);
const transcribedPath = transcribedAssPath(session);

let loaded = false;
if (await pathExists(translatedPath)) {
  try {
    loadAssDocument(parseAss(await loadAssText(translatedPath)), {
      kind: "translated",
      path: translatedPath,
    });
    loaded = true;
  } catch {
    loaded = false;
  }
}
if (!loaded && await pathExists(transcribedPath)) {
  try {
    loadAssDocument(parseAss(await loadAssText(transcribedPath)), {
      kind: "transcribed",
      path: transcribedPath,
    });
    loaded = true;
  } catch {
    loaded = false;
  }
}

setStep("transcribe");
```

Update copy to say `选择视频文件，字幕将保存到视频同目录`. Remove the “open existing project” card.

- [ ] **Step 4: Update DownloadView**

In `src/components/workflow/DownloadView.tsx`, replace completion import with:

```ts
const session = await prepareVideoSession(completedPath);
setSession(session);
setStep("transcribe");
```

Do not call `loadAssDocument` in this flow. Change button/copy from project wording to video/session wording:

- `完成后可导入为 Hikaru Sub 项目` -> `完成后可打开并继续转录`
- `导入为项目` -> `打开并转录`
- `创建项目失败` -> `打开视频失败`

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm test -- tests/FileCenteredWorkflow.test.ts
git status --short
```

Expected: tests pass. Do not commit.

---

## Task 5: Transcription and Translation Paths

**Files:**
- Modify: `src/components/workflow/TranscribeView.tsx`
- Modify: `src/components/workflow/TranslateView.tsx`
- Modify: `tests/FileCenteredWorkflow.test.ts`

**Behavior:**
- Transcription output path is exactly `session.transcribedAssPath`.
- Translation output path is exactly `session.translatedAssPath`.
- ASR/translation settings are read from current app settings or current page controls, not from session metadata.
- Successful transcription deletes cached `audio.wav`.

- [ ] **Step 1: Add failing guards for strict save paths**

Extend `tests/FileCenteredWorkflow.test.ts`:

```ts
const transcribeSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/TranscribeView.tsx", import.meta.url)),
  "utf8",
);
const translateSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/TranslateView.tsx", import.meta.url)),
  "utf8",
);

describe("file-centered transcription and translation", () => {
  it("uses strict session subtitle paths", () => {
    expect(transcribeSource).toContain("session.transcribedAssPath");
    expect(transcribeSource).toContain("deleteCachedAudio(session.audioPath)");
    expect(translateSource).toContain("session.translatedAssPath");
    expect(translateSource).not.toContain("replace(/\\.ass$/i");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm test -- tests/FileCenteredWorkflow.test.ts
```

Expected: fails until transcribe/translate pages use session paths.

- [ ] **Step 3: Update TranscribeView**

In `src/components/workflow/TranscribeView.tsx`:

- replace `project` reads with `session`.
- initialize ASR controls from `getSettings()` instead of session metadata.
- change missing audio path text to `当前视频会话缺少音轨缓存路径`.
- call `startAsr` with:

```ts
outputAssPath: session.transcribedAssPath,
```

- when saving the ASS:

```ts
await saveAssText(session.transcribedAssPath, assText);
setSavedAssPath(session.transcribedAssPath);
setActiveSubtitle("transcribed", session.transcribedAssPath);
await deleteCachedAudio(session.audioPath);
setAudioReady(false);
```

- change empty state copy from `尚未打开项目` to `尚未打开视频`.
- change success text to `转录字幕已保存到`.

- [ ] **Step 4: Update TranslateView**

In `src/components/workflow/TranslateView.tsx`:

- replace `project` reads with `session`.
- use `session.transcribedAssPath` for prerequisite file checks and source ASS loading.
- use `session.translatedAssPath` for saving.
- after saving translated ASS, call:

```ts
setActiveSubtitle("translated", session.translatedAssPath);
```

- remove all `.ass` replacement logic.
- change `当前项目没有字幕条目，请先完成转录` to `当前视频没有字幕条目，请先完成转录`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm test -- tests/FileCenteredWorkflow.test.ts
git status --short
```

Expected: tests pass. Do not commit.

---

## Task 6: Editor Save Target and File Actions

**Files:**
- Modify: `src/components/editor/EditorView.tsx`
- Modify: `tests/EditorViewBehavior.test.ts`
- Modify: `tests/FileCenteredWorkflow.test.ts`

**Behavior:**
- Save uses `activeSubtitlePath`.
- If there is no active subtitle path, save creates `session.transcribedAssPath` and activates it.
- `选择字幕文件` loads an external `.ass` or `.srt` as the complete translated subtitle document.
- External `.ass` keeps its cues/styles and overwrites `PlayResX/Y` with the current video resolution.
- External `.srt` is converted to an ASS document with the current video resolution.
- After selecting an external subtitle, the active subtitle kind is `translated` and the active path is `null`; first save prompts for an ASS save path, defaulting to `session.translatedAssPath`.
- `在文件夹中显示` is disabled when the file is missing.
- The global StatusBar does not show an unsaved subtitle tag.

- [ ] **Step 1: Add failing editor guards**

Update `tests/EditorViewBehavior.test.ts`:

```ts
it("saves to the active subtitle path instead of inferring from cue content", () => {
  expect(source).toContain("activeSubtitlePath");
  expect(source).toContain("setActiveSubtitle");
  expect(source).not.toContain("secondaryText) ?"); 
});

it("selects external subtitle files as translated documents", () => {
  expect(source).toContain("handleSelectSubtitleFile");
  expect(source).toContain("pickSubtitleFile()");
  expect(source).toContain("parseExternalSubtitleDocument");
  expect(source).toContain('loadAssDocument(doc, { kind: "translated", path: null })');
  expect(source).toContain("pickSaveAssFile(session.translatedAssPath)");
  expect(source).toContain("revealItemInDir");
  expect(source).toContain("pathExists(currentSubtitlePath)");
  expect(source).toContain("disabled={!subtitleFileExists}");
  expect(source).toContain("选择字幕文件");
  expect(source).toContain("在文件夹中显示");
  expect(source).not.toContain("打开字幕文件");
});
```

- [ ] **Step 2: Run failing editor tests**

Run:

```bash
pnpm test -- tests/EditorViewBehavior.test.ts
```

Expected: fails until the editor uses active subtitle state, external subtitle selection, and first-save-as behavior.

- [ ] **Step 3: Update save target**

In `src/components/editor/EditorView.tsx`, read:

```ts
const session = useProjectStore((s) => s.session);
const activeSubtitlePath = useProjectStore((s) => s.activeSubtitlePath);
const activeSubtitleKind = useProjectStore((s) => s.activeSubtitleKind);
const setActiveSubtitle = useProjectStore((s) => s.setActiveSubtitle);
```

Replace save-path selection with:

```ts
let savePath = activeSubtitlePath;
const saveKind: ActiveSubtitleKind = activeSubtitleKind ?? "transcribed";
if (!savePath) {
  if (saveKind === "translated") {
    savePath = await pickSaveAssFile(session.translatedAssPath);
    if (!savePath) return;
  } else {
    savePath = session.transcribedAssPath;
  }
}
await writeSubtitleFile(savePath, saveKind);
```

Do not inspect `secondaryText` to choose a file.

- [ ] **Step 4: Add subtitle file existence state**

In `EditorView`, add:

```ts
const [subtitleFileExists, setSubtitleFileExists] = useState(false);

const currentSubtitlePath =
  activeSubtitlePath ??
  (activeSubtitleKind === "translated"
    ? null
    : session?.transcribedAssPath ?? null);

useEffect(() => {
  let cancelled = false;
  if (!currentSubtitlePath) {
    setSubtitleFileExists(false);
    return;
  }
  pathExists(currentSubtitlePath)
    .then((exists) => {
      if (!cancelled) setSubtitleFileExists(exists);
    })
    .catch(() => {
      if (!cancelled) setSubtitleFileExists(false);
    });
  return () => {
    cancelled = true;
  };
}, [currentSubtitlePath]);
```

- [ ] **Step 5: Add external subtitle selection behavior**

Import:

```ts
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  getSettings,
  getVideoInfo,
  loadAssText,
  pathExists,
  pickSaveAssFile,
  pickSubtitleFile,
  saveAssText,
} from "../../services/tauri";
import { parseExternalSubtitleDocument } from "../../utils/subtitleImport";
```

Add:

```ts
const handleSelectSubtitleFile = async () => {
  if (!session) return;

  try {
    const subtitlePath = await pickSubtitleFile();
    if (!subtitlePath) return;

    const [subtitleText, videoInfo] = await Promise.all([
      loadAssText(subtitlePath),
      getVideoInfo(session.videoPath),
    ]);
    const doc = parseExternalSubtitleDocument({
      path: subtitlePath,
      text: subtitleText,
      playRes: { width: videoInfo.width, height: videoInfo.height },
    });

    loadAssDocument(doc, { kind: "translated", path: null });
    markDirty();
    setSubtitleFileExists(false);
    setSaveError(null);
    notify("info", "已载入字幕文件，首次保存时请选择保存位置");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify("error", `选择字幕文件失败：${message}`);
  }
};

const handleRevealSubtitleFile = async () => {
  if (!currentSubtitlePath || !subtitleFileExists) return;
  try {
    await revealItemInDir(currentSubtitlePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify("error", `无法打开文件夹：${message}`);
  }
};
```

- [ ] **Step 6: Add toolbar buttons**

Add before the style manager button:

```tsx
<button
  type="button"
  onClick={handleSelectSubtitleFile}
  className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-text hover:border-accent/50 hover:bg-surface-overlay"
>
  选择字幕文件
</button>
<button
  type="button"
  onClick={handleRevealSubtitleFile}
  disabled={!subtitleFileExists}
  className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-text hover:border-accent/50 hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50"
>
  在文件夹中显示
</button>
```

Change empty state copy to `请先打开视频`.

- [ ] **Step 7: Run editor tests**

Run:

```bash
pnpm test -- tests/EditorViewBehavior.test.ts tests/FileCenteredWorkflow.test.ts
git status --short
```

Expected: tests pass. Do not commit.

---

## Task 7: Burn Input Uses Cache Path

**Files:**
- Modify: `src/components/workflow/BurnView.tsx`
- Modify: `tests/BurnView.test.ts`
- Modify: `tests/FileCenteredWorkflow.test.ts`

**Behavior:**
- Burn input ASS is always `session.burnAssPath`.
- Burn page no longer depends on a project directory field.

- [ ] **Step 1: Add failing burn guards**

Extend `tests/BurnView.test.ts`:

```ts
it("writes temporary burn ASS to the session cache path", () => {
  expect(source).toContain("session.burnAssPath");
  expect(source).not.toContain("burn.input.ass`");
});
```

Extend `tests/FileCenteredWorkflow.test.ts`:

```ts
const burnSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/BurnView.tsx", import.meta.url)),
  "utf8",
);

it("keeps burn input in cache via the prepared session path", () => {
  expect(burnSource).toContain("session.burnAssPath");
  expect(burnSource).not.toContain("projectDir");
});
```

- [ ] **Step 2: Update BurnView**

In `src/components/workflow/BurnView.tsx`:

- replace `project` with `session`.
- remove `projectDir`.
- change `canStart` to:

```ts
const canStart =
  Boolean(session?.videoPath && session?.burnAssPath && cues.length > 0) &&
  Boolean(outputPath) &&
  !busy;
```

- change `runStart` guard and path:

```ts
if (!session || !session.burnAssPath || !outputPath) return;
const burnAssPath = session.burnAssPath;
await saveAssText(burnAssPath, assText);

const id = await startBurnSubtitles({
  videoPath: session.videoPath,
  assPath: burnAssPath,
  outputPath,
  mode,
  crf: mode === "hardSubMp4" ? crf : null,
  preset: mode === "hardSubMp4" ? preset : null,
  videoEncoder: mode === "hardSubMp4" ? videoEncoder : null,
  videoBitrateKbps: mode === "hardSubMp4" ? effectiveVideoBitrateKbps : null,
  fontDir: mode === "hardSubMp4" && fontDir.trim() ? fontDir.trim() : null,
});
```

- change empty state copy to `请先打开视频`.

- [ ] **Step 3: Run burn tests**

Run:

```bash
pnpm test -- tests/BurnView.test.ts tests/FileCenteredWorkflow.test.ts
git status --short
```

Expected: tests pass. Do not commit.

---

## Task 8: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `asr-service/README.md`
- Modify: `src-tauri/resources/asr-service/README.md`
- Modify: tests as needed for source guards

**Behavior:**
- Documentation describes visible subtitle files and app-cache intermediates.
- No runtime code, tests, or user docs describe the old hidden-project file model.

- [ ] **Step 1: Update README file-management sections**

In `README.md`, replace old project-file descriptions with:

```markdown
### 文件管理

- **转录字幕**：`<视频文件名>.transcribed.ass`（与视频同目录）
- **翻译字幕**：`<视频文件名>.translated.ass`（与视频同目录，按设置保存为行内双语或分离双行）
- **音频缓存**：应用缓存目录下的 `workspace/<video-path-hash>/audio.wav`，转录成功保存后删除
- **ASR 恢复快照**：应用缓存目录下的 `workspace/<video-path-hash>/asr-jobs/*.json`
- **压制临时字幕**：应用缓存目录下的 `workspace/<video-path-hash>/burn.input.ass`
- **代理视频缓存**：应用缓存目录下的 `transcode/*.mp4`
```

Update workflow language to say `导入视频 → 准备视频会话并在视频同目录生成字幕`.

- [ ] **Step 2: Update AGENTS data/subtitle convention section**

In `AGENTS.md`, replace the current project-file section with:

```markdown
### 用户可见字幕文件

Hikaru Sub 不再在视频目录创建隐藏项目文件夹。用户可见输出位于视频同目录：

- `<视频文件名>.transcribed.ass`
- `<视频文件名>.translated.ass`

提取音频、ASR 恢复快照和压制临时 ASS 属于中间文件，位于应用缓存目录的 `workspace/<video-path-hash>/` 下，不写入视频目录。转录成功保存后删除缓存音频 `audio.wav`。
```

Keep the existing `SubtitleCue` and merge-mode rules below it. Remove the line that says old projects with other `sourceLang` should open.

- [ ] **Step 3: Update ASR sidecar README files**

In both `asr-service/README.md` and `src-tauri/resources/asr-service/README.md`, change request examples to use:

```json
{
  "audioPath": "/path/to/app-cache/workspace/hash/audio.wav",
  "outputAssPath": "/path/to/video/episode.transcribed.ass"
}
```

Document that `outputAssPath` is required for app-driven transcription.

- [ ] **Step 4: Run repository-wide obsolete-content searches**

Run these PowerShell commands:

```powershell
$oldHidden = '.hi' + 'karu'
$oldProjectType = 'Project' + 'Meta'
$oldCreate = 'create' + 'Project'
$oldOpen = 'open' + 'Project'
$oldCreateCommand = 'create_' + 'project'
$oldOpenCommand = 'open_' + 'project'
$oldProjectDirHelper = 'project' + 'DirFromMeta'
$oldAssName = 'subtitles' + '.ass'
$oldTranslatedName = 'subtitles' + '.translated' + '.ass'
rg -n "$oldHidden|$oldProjectType|$oldCreate|$oldOpen|$oldCreateCommand|$oldOpenCommand|$oldProjectDirHelper|$oldAssName|$oldTranslatedName" src src-tauri asr-service README.md AGENTS.md tests docs
```

Expected: no matches, except false positives that are unrelated to the old file model and are explicitly documented in the final report.

- [ ] **Step 5: Run focused test suites**

Run:

```bash
pnpm test -- tests/FileCenteredWorkflow.test.ts tests/EditorViewBehavior.test.ts tests/BurnView.test.ts src/stores/projectStore.test.ts
cargo test --manifest-path src-tauri/Cargo.toml project -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml ass::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml asr::tests -- --nocapture
python -m unittest asr-service.tests.test_jobs
```

Expected: all focused tests pass.

- [ ] **Step 6: Run full validation required by the touched surface**

Run:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
python -m unittest discover -s asr-service/tests
```

Expected: all commands pass. If a command fails because of an unrelated environmental dependency, capture the exact failure and include it in the final report.

- [ ] **Step 7: Final diff checkpoint without committing**

Run:

```bash
git status --short
git diff -- src-tauri/src/project.rs src-tauri/src/lib.rs src-tauri/src/ass.rs src-tauri/src/asr.rs asr-service/jobs.py src-tauri/resources/asr-service/jobs.py asr-service/tests/test_jobs.py src/types/index.ts src/services/tauri.ts src/stores/projectStore.ts src/components/workflow/ImportView.tsx src/components/workflow/DownloadView.tsx src/components/workflow/TranscribeView.tsx src/components/workflow/TranslateView.tsx src/components/editor/EditorView.tsx src/components/workflow/BurnView.tsx README.md AGENTS.md asr-service/README.md src-tauri/resources/asr-service/README.md
```

Expected: diff matches this plan. Do not commit unless the user explicitly requests a commit in a separate instruction.
