# Hikaru-Sub Release Packaging Design

## Goal

Make Hikaru-Sub produce downloadable desktop installers from GitHub Releases.
This phase intentionally implements option A only: build and upload client
packages, without Tauri updater support or in-app auto update.

## Scope

In scope:

- Add a GitHub Actions release workflow.
- Build Windows and macOS desktop bundles through Tauri.
- Upload generated bundle artifacts to a GitHub Release.
- Fetch platform FFmpeg/FFprobe binaries during CI before bundling.
- Add local package scripts that mirror the CI packaging path.
- Document the release process for maintainers.

Out of scope:

- Tauri updater artifacts, updater endpoints, signing keys, and in-app update UI.
- Linux desktop packaging. Add it after Windows/macOS releases are stable.
- macOS notarization and store distribution.
- Windows code-signing certificates.
- Bundling Python ASR dependencies or model weights in the installer.
- Client-side ASR one-click setup. That is the next separate feature.

## Release Trigger

The workflow should support two entry points:

- Tag release: pushing a tag matching `v*`, such as `v0.1.0`.
- Manual release: `workflow_dispatch`, useful for testing a release candidate.

For tag releases, the GitHub Release name should use the tag. For manual runs,
the workflow can create or update a draft/prerelease style release name derived
from the supplied version input if an input is added later. The first
implementation can keep manual runs as artifact-producing validation if creating
ad hoc releases becomes awkward.

## Build Matrix

The first release workflow should build on:

- `windows-latest`
- `macos-15-intel` for macOS Intel
- `macos-15` for macOS Apple Silicon

Windows and macOS should rely on the standard hosted runner toolchains plus
Rust, Node, and pnpm setup. Linux packaging is deferred until the Windows/macOS
release path is proven.

## CI Steps

Each matrix job should:

1. Check out the repository.
2. Install pnpm using the package manager version from `package.json`.
3. Set up Node 20.
4. Set up stable Rust.
5. Run `pnpm install --frozen-lockfile`.
6. Run `pnpm ffmpeg:fetch` so `src-tauri/binaries/*` contains platform FFmpeg
   and FFprobe before Tauri bundles resources.
7. Run the relevant verification commands:
   - `pnpm test`
   - `pnpm build`
   - `cargo test` in `src-tauri`
8. Run Tauri bundle creation.
9. Upload generated installers/packages to the GitHub Release.

The workflow should not commit generated binaries or bundle output back to the
repository.

## Tauri Bundle Behavior

The existing `src-tauri/tauri.conf.json` already enables bundling and includes
`binaries/*` as resources. The release workflow should reuse this setup instead
of checking FFmpeg binaries into git.

The first release can avoid paid certificate signing and notarization. For
macOS, use Tauri's ad-hoc signing identity (`"-"`) so Apple Silicon builds have
a code signature even without an Apple Developer certificate. This means:

- Windows may show SmartScreen warnings.
- macOS may still show Gatekeeper warnings because the app is not notarized.

These limitations should be documented in the release notes or README rather
than hidden.

## Local Scripts

Add package scripts that make the release path easy to reproduce locally:

- `build:desktop`: run the frontend build and Tauri build.
- `bundle`: alias for Tauri bundle/build if the repository prefers shorter
  naming.
- `release:local`: fetch FFmpeg and then build the desktop bundle for the
  current platform.

The scripts must use pnpm and existing Tauri commands. They should not publish,
tag, push, or commit anything.

## Artifact Naming

Use Tauri's generated artifact names for the first implementation. Avoid custom
renaming until the build matrix proves stable. If a later release needs cleaner
names, add a separate packaging normalization step.

## Failure Handling

The workflow should fail fast on:

- Missing lockfile compatibility.
- FFmpeg download or extraction failure.
- TypeScript/Vite build failure.
- Rust test failure.
- Tauri bundling failure.

`scripts/fetch-ffmpeg.mjs` already supports `FFMPEG_URL` overrides, so CI can be
re-run with alternate sources if a public FFmpeg mirror is unavailable.

## Documentation

Add a short release section to README or a dedicated docs file covering:

- How to cut a release tag.
- Which packages GitHub Actions produces.
- That FFmpeg is included in release bundles.
- That ASR engine dependencies are configured after installation, not bundled.
- That Linux packages are intentionally deferred until Windows/macOS releases
  are stable.
- Current unsigned/not-notarized package limitations, including macOS ad-hoc
  signing and Gatekeeper behavior.

## Verification

Before considering this phase implemented:

- `pnpm test` passes.
- `pnpm build` passes.
- `cargo test` passes in `src-tauri`.
- `pnpm release:local` or the equivalent local bundle command succeeds on the
  current platform if the machine has the required Tauri toolchain.
- The GitHub Actions workflow syntax is valid and references existing scripts.

## Follow-Up

After release packaging works, implement the ASR sidecar one-click setup as a
separate feature. That work should add client-side install tasks for Python
venv/dependencies, engine profile selection, log/progress display, and sidecar
restart/recheck integration.

Linux desktop packaging should be added after the Windows/macOS release workflow
is proven. That follow-up should add the Ubuntu runner, WebKit/Tauri Linux
dependencies, and Linux artifact documentation.
