# Install Directory Runtime Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Hikaru Sub managed runtime dependencies under the selected installation directory and keep product/path naming consistent.

**Architecture:** Keep the installer current-user by default, override its default install path to `%LOCALAPPDATA%\Programs\hikaru-sub`, and resolve managed runtime dependencies from the executable's install directory. When the install directory is not writable, dependency preparation attempts a Windows UAC elevation restart instead of falling back to AppData.

**Tech Stack:** Tauri 2, Rust, NSIS hooks, React/TypeScript, Vitest, Cargo tests.

---

### File Structure

- Modify `src-tauri/tauri.conf.json`: user-facing product/window name becomes `Hikaru Sub`; NSIS config points at an installer hook.
- Create `src-tauri/windows/nsis-hooks.nsh`: override default `$INSTDIR` to `$LOCALAPPDATA\Programs\hikaru-sub` and remove `deps` during uninstall when the user chooses app-data deletion.
- Modify `src-tauri/src/dependencies.rs`: resolve `deps` under the install directory, expose writability/elevation helpers, keep cleanup guards under that root.
- Modify `src-tauri/src/lib.rs`: run a startup writability probe and expose dependency state.
- Modify docs/tests: encode naming rules in `AGENTS.md`, update README wording, and add tests for installer config and dependency paths.

### Task 1: Installer Defaults And Naming

- [ ] **Step 1: Write failing installer config tests**

Add tests in `tests/WindowsBundleConfig.test.ts` that assert `productName` is `Hikaru Sub`, `bundle.windows.nsis.installerHooks` is present, and the hook file contains `%LOCALAPPDATA%\Programs\hikaru-sub`.

- [ ] **Step 2: Verify red**

Run `pnpm test -- tests/WindowsBundleConfig.test.ts`. Expected: fails because current product name is `Hikaru-Sub` and no hook exists.

- [ ] **Step 3: Implement installer config**

Update `src-tauri/tauri.conf.json`, create `src-tauri/windows/nsis-hooks.nsh`, and update user-facing docs to say `Hikaru Sub`.

- [ ] **Step 4: Verify green**

Run `pnpm test -- tests/WindowsBundleConfig.test.ts`. Expected: passes.

### Task 2: Install-Dir Dependency Root

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/dependencies.rs` for `deps_dir_from_install_dir(Path::new("C:/Users/A/AppData/Local/Programs/hikaru-sub/hikaru-sub.exe")) == .../deps` and for cleanup guards using install-dir deps.

- [ ] **Step 2: Verify red**

Run `cargo test --manifest-path src-tauri/Cargo.toml dependencies::tests::dependency_paths_live_under_install_dir`. Expected: fails because the helper does not exist or still expects AppData.

- [ ] **Step 3: Implement dependency root**

Change runtime dependency roots from `app.path().app_data_dir()/deps` to `current_exe().parent()/deps`. Do not fall back to profile data directories for large managed dependencies.

- [ ] **Step 4: Verify green**

Run `cargo test --manifest-path src-tauri/Cargo.toml dependencies::tests::dependency_paths_live_under_install_dir`. Expected: passes.

### Task 3: Writability And Elevation

- [ ] **Step 1: Write failing Rust tests**

Add tests for install-dir writability probe filenames staying under `deps`, and for elevation command arguments using `runas` on Windows.

- [ ] **Step 2: Verify red**

Run targeted cargo tests. Expected: fails because helpers are missing.

- [ ] **Step 3: Implement runtime behavior**

Before managed downloads/setup, ensure `deps` is writable. If not writable on Windows, spawn the current executable via PowerShell `Start-Process -Verb RunAs` and return an explicit error indicating Hikaru Sub is restarting with administrator privileges. If UAC is cancelled, keep the current process alive and surface the error.

- [ ] **Step 4: Verify green**

Run targeted cargo tests. Expected: passes.

### Task 4: Full Verification

- [ ] **Step 1: Run frontend tests**

Run `pnpm test`. Expected: all tests pass.

- [ ] **Step 2: Run Rust tests**

Run `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: all tests pass.

- [ ] **Step 3: Run local release build**

Run `pnpm release:local`. Expected: Windows NSIS setup builds, generated installer script uses `Hikaru Sub` display name and defaults to `%LOCALAPPDATA%\Programs\hikaru-sub`.

- [ ] **Step 4: Inspect status**

Run `git diff --check` and `git status --short --branch`. Expected: no whitespace errors; changes are unstaged/uncommitted unless the user explicitly asks for a commit.
