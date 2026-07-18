# Services and Tauri Bridge

## Role of `src/services/tauri.ts`

Single frontend façade for product Tauri commands and common dialogs:

- `invoke(...)` wrappers with typed args/results from `src/types`
- File/directory pickers via `@tauri-apps/plugin-dialog`
- Event listeners (e.g. audio extract progress)
- Small helpers (`transcribedAssPath`, `translatedAssPath`, FFmpeg status cache + invalidation event)

Components and hooks should import from this module (or a thin domain service that uses it), not scatter raw `invoke("command_name")` calls.

## New Command Wiring (Frontend End)

When Rust adds a command, frontend work ends here:

1. Add/adjust types in `src/types/index.ts`
2. Export a wrapper in `src/services/tauri.ts`
3. Call the wrapper from stores/hooks/views
4. Cover behavior with tests when logic is non-trivial (`src/services/tauri*.test.ts`, store tests, etc.)

Full chain (must stay intact): **Rust impl → `lib.rs` `generate_handler!` → `tauri.ts` → UI**. Capability updates live on the Tauri side (`src-tauri/capabilities/`).

## Related Services (Not Raw Invoke)

| Module | Purpose |
|--------|---------|
| `previewFontDiscovery.ts` | Singleton cache over `discoverPreviewFonts` |
| `libassPreview.ts` / `libassFontSelection.ts` / `fontCoverage.ts` | Preview rendering / glyph fallback |
| `translation/` | OpenAI-compatible / Gemini / Anthropic HTTP, model discovery, shared batching/fallback, and request scheduling |
| `editorActions.ts` | Pure editor list actions (split/merge/timing/delete) on cue arrays |
| `subtitleClipboard.ts` | Whole-row ASS event copy/cut/paste via `@tauri-apps/plugin-clipboard-manager` + `eventLine` codec |

Official Tauri plugins (e.g. clipboard-manager) are called from a focused domain service (`subtitleClipboard.ts`), not from React components and not via a custom Rust command / `tauri.ts` invoke. Still register the plugin in `lib.rs` and grant only needed capabilities (`clipboard-manager:allow-read-text`, `allow-write-text`).

Translation API keys are the approved exception to the general invoke-secret rule: every provider carries an `apiKey: string` in the existing complete `AppSettings` get/set IPC and plaintext local `settings.json` flow so Settings can round-trip, replace, and clear it. Empty or whitespace-only keys fail provider readiness and model-discovery gating. Do not add keys to unrelated invoke payloads, source, fixtures, request-body logs, or auth-header logs.

## Patterns to Preserve

- **FFmpeg status**: `checkFfmpeg` caches a promise; `invalidateFfmpegStatus` clears it and dispatches `hikaru-sub:ffmpeg-status-invalidated`.
- **ASS I/O**: `loadAssText` / `saveAssText` move bytes; parse/serialize stays in `lib/ass`.
- **Media playback**: `registerMediaPlayback(path)` → `http://127.0.0.1:.../media/{token}` URL for `<video>`.
- **Runtime deps**: `probeRuntimeDependencies` for status; `measureRuntimeDependencyStorage` only when user asks to compute size; cleanup only after measure > 0 for managed targets.

## Anti-Patterns

- Calling `invoke` from a React component for a command that already has a wrapper
- Skipping type updates when Rust payload changes
- Putting translation API keys into unrelated Tauri invoke payloads, source, fixtures, or logs
- Using Tauri `asset://` as the primary editor playback path again
