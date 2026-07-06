# Release Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows/macOS GitHub Release packaging pipeline that produces downloadable Hikaru-Sub desktop installers without adding Tauri updater support.

**Architecture:** Keep release packaging outside the application runtime. CI fetches platform FFmpeg binaries into `src-tauri/binaries/`, runs the existing frontend/Rust checks, then lets `tauri-apps/tauri-action` build and upload bundles to a draft GitHub Release. Local scripts mirror the same packaging path without tagging, pushing, publishing, or committing.

**Tech Stack:** pnpm workspace, Vite/TypeScript, Tauri 2, Rust stable, GitHub Actions, `tauri-apps/tauri-action@v1`, `scripts/fetch-ffmpeg.mjs`.

---

## Project Rule Override

The repository AGENTS instructions forbid autonomous commits. Any step that would normally commit must instead stop after verification and ask the user whether to commit.

## File Structure

- Modify `package.json`: add local packaging scripts that reuse the existing Tauri CLI and FFmpeg fetch script.
- Create `.github/workflows/release.yml`: build Windows and macOS release bundles on tag or manual dispatch.
- Modify `README.md`: document how maintainers cut a release and what the first release does not include.
- Leave `src-tauri/tauri.conf.json` unchanged; macOS ad-hoc signing is handled by the workflow environment variable `APPLE_SIGNING_IDENTITY: "-"`.

### Task 1: Add Local Packaging Scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check the current script block**

Run:

```bash
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2))"
```

Expected: output includes `dev`, `build`, `test`, `tauri`, `ffmpeg:fetch`, and `asr:setup`.

- [ ] **Step 2: Update `package.json` scripts**

Edit only the `scripts` object so it becomes:

```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "test": "vitest run",
  "preview": "vite preview",
  "tauri": "tauri",
  "build:desktop": "tauri build",
  "bundle": "tauri build",
  "release:local": "pnpm ffmpeg:fetch && tauri build",
  "ffmpeg:fetch": "node scripts/fetch-ffmpeg.mjs",
  "asr:setup": "bash scripts/setup-asr.sh"
}
```

Do not alter dependency versions or lockfiles.

- [ ] **Step 3: Verify the scripts exist**

Run:

```bash
node -e "const s=require('./package.json').scripts; for (const k of ['build:desktop','bundle','release:local']) { if (!s[k]) throw new Error(k + ' missing'); } console.log('release scripts ok')"
```

Expected: `release scripts ok`.

- [ ] **Step 4: Pause before commit**

Do not run `git commit`. Note that `package.json` has changed and continue to the next task.

### Task 2: Add the Windows/macOS Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow directory**

Run:

```bash
mkdir -p .github/workflows
```

On PowerShell, use:

```powershell
New-Item -ItemType Directory -Force .github/workflows
```

- [ ] **Step 2: Write `.github/workflows/release.yml`**

Create the file with exactly this content:

```yaml
name: Release Desktop Clients

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs:
      tag:
        description: "Release tag to create or update, for example v0.1.0-rc.1"
        required: true
        type: string

permissions:
  contents: write

jobs:
  release:
    name: Build ${{ matrix.label }}
    runs-on: ${{ matrix.platform }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - label: Windows
            platform: windows-latest
            target: ""
            args: ""
          - label: macOS Intel
            platform: macos-15-intel
            target: x86_64-apple-darwin
            args: "--target x86_64-apple-darwin"
          - label: macOS Apple Silicon
            platform: macos-15
            target: aarch64-apple-darwin
            args: "--target aarch64-apple-darwin"

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          run_install: false

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Add Rust target
        if: matrix.target != ''
        run: rustup target add ${{ matrix.target }}

      - name: Cache Rust build
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Fetch FFmpeg
        run: pnpm ffmpeg:fetch

      - name: Run frontend tests
        run: pnpm test

      - name: Build frontend
        run: pnpm build

      - name: Run Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml

      - name: Build and upload Tauri bundles
        uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_SIGNING_IDENTITY: "-"
        with:
          projectPath: .
          args: ${{ matrix.args }}
          tagName: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}
          releaseName: Hikaru-Sub ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}
          releaseBody: |
            Hikaru-Sub desktop client release.

            This release includes bundled FFmpeg/FFprobe for the packaged platform.
            ASR engine dependencies and model weights are configured after installation.
            Linux packages are intentionally deferred until Windows/macOS releases are stable.
            Windows packages are not code-signed and may show SmartScreen warnings.
            macOS packages use ad-hoc signing but are not notarized, so Gatekeeper warnings may appear.
          releaseDraft: true
          prerelease: ${{ contains(github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name, '-') }}
```

- [ ] **Step 3: Verify workflow text references only Windows/macOS**

Run:

```bash
rg -n "ubuntu|linux-latest|apt-get|webkit2gtk" .github/workflows/release.yml
```

Expected: no matches and exit code `1`.

- [ ] **Step 4: Verify required release settings are present**

Run:

```bash
rg -n "contents: write|tauri-apps/tauri-action@v1|pnpm ffmpeg:fetch|APPLE_SIGNING_IDENTITY|x86_64-apple-darwin|aarch64-apple-darwin" .github/workflows/release.yml
```

Expected: matches for all listed strings.

- [ ] **Step 5: Pause before commit**

Do not run `git commit`. Note that `.github/workflows/release.yml` has been added and continue to the next task.

### Task 3: Document the Release Process

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the development section**

Run:

```bash
rg -n "^## 开发|pnpm tauri build|ASR sidecar" README.md
```

Expected: the command prints the existing development and ASR sections.

- [ ] **Step 2: Add a release section after the development commands**

Insert this section after the development command block in `README.md`:

````markdown
## 发布客户端

首期发布目标是 Windows 与 macOS 安装包；Linux 客户端会在 Windows/macOS 发布链路稳定后再加入。

### 本地打包

```bash
pnpm release:local
```

该命令会先按当前平台下载 FFmpeg/FFprobe 到 `src-tauri/binaries/`，再执行 Tauri 打包。生成产物位于 `src-tauri/target/release/bundle/`。

### GitHub Release

推送 `v*` 标签会触发 `.github/workflows/release.yml`：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会构建 Windows、macOS Intel 与 macOS Apple Silicon 产物，并上传到 GitHub Release 草稿。也可以从 GitHub Actions 手动运行 `Release Desktop Clients`，输入要创建或更新的 release tag。

发布包会随平台包含 FFmpeg/FFprobe。ASR Python 依赖、Parakeet/Qwen3-ASR 可选依赖和模型权重不随安装包预装，安装后通过客户端内的 ASR 配置流程准备。

当前发布限制：

- Windows 包未做代码签名，可能出现 SmartScreen 提示。
- macOS 包使用 ad-hoc signing，但未做 notarization，可能出现 Gatekeeper 提示。
- Linux 包暂不发布。
````

If this creates duplicate wording with nearby sections, keep the new release section and avoid editing unrelated content.

- [ ] **Step 3: Verify release documentation mentions the intended scope**

Run:

```bash
rg -n "发布客户端|Windows 与 macOS|Linux 客户端|release:local|GitHub Release|SmartScreen|Gatekeeper|ASR Python" README.md
```

Expected: each term appears in the new release section.

- [ ] **Step 4: Pause before commit**

Do not run `git commit`. Note that `README.md` has changed and continue to the next task.

### Task 4: Run Local Verification

**Files:**
- Verify: `package.json`
- Verify: `.github/workflows/release.yml`
- Verify: `README.md`

- [ ] **Step 1: Run frontend/unit tests**

Run:

```bash
pnpm test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run frontend production build**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite build exit successfully. Existing Vite warnings about jASSUB assets or mixed static/dynamic imports are acceptable if the command exits `0`.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 4: Verify release script wiring without downloading FFmpeg**

Run:

```bash
node -e "const s=require('./package.json').scripts; if (s['release:local'] !== 'pnpm ffmpeg:fetch && tauri build') throw new Error('bad release:local script'); console.log(s['release:local'])"
```

Expected: `pnpm ffmpeg:fetch && tauri build`.

- [ ] **Step 5: Optional local bundle smoke test**

Run only if the current machine has the Tauri desktop build toolchain and network access for FFmpeg downloads:

```bash
pnpm release:local
```

Expected: current-platform bundle artifacts are created under `src-tauri/target/release/bundle/`.

If this fails because a platform-specific signing/toolchain/network prerequisite is missing, record the exact error and do not mask it.

- [ ] **Step 6: Review changed files**

Run:

```bash
git diff -- package.json .github/workflows/release.yml README.md docs/superpowers/specs/2026-07-06-release-packaging-design.md docs/superpowers/plans/2026-07-06-release-packaging.md
```

Expected: diff contains only release packaging scripts, the release workflow, release docs, and the spec/plan updates.

- [ ] **Step 7: Ask before committing**

Do not run `git add`, `git commit`, `git push`, or create tags unless the user explicitly asks. Report verification results and ask whether they want a commit or release tag next.
