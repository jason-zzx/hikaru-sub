# Settings category navigation — implementation plan

## Checklist

1. **Introduce category type + shell layout**
   - Add `SettingsCategory = "runtime" | "transcription" | "translation"`.
   - Restructure `SettingsView` header + body into left nav + right pane.
   - Default `activeCategory` to `"runtime"` on mount.
   - Keep existing draft / Save / message / runtime / ASR-setup state in the shell.

2. **Extract `SettingsTranscriptionPanel`**
   - Move ASR defaults UI (engine, model, device, ModelManager, AsrEngineSetupPanel) into the new panel.
   - Wire props from shell (`settings` slice, `update`, setup callbacks, refresh key, disabled flags).

3. **Extract `SettingsTranslationPanel`**
   - Move translation fields + default target language into the new panel.
   - Wire props from shell.

4. **Wire runtime category + "去配置"**
   - Render `RuntimeDependenciesPanel` directly in the shell (no pass-through wrapper).
   - Replace `asrSectionRef` / `scrollIntoView` with `setActiveCategory("transcription")`.
   - Remove the ref once unused.

5. **Polish chrome**
   - Selected nav styles via existing tokens.
   - Category-aware (or static) header subtitle.
   - Ensure only the right pane scrolls; cleanup dialog stays on shell.

6. **Tests**
   - Fix `tests/SettingsViewAsrSetup.test.ts` for the new file split.
   - Add or extend a light shell-level assertion for default category + configure → transcription if cheap.
   - Leave `SettingsRuntimeDependencies.test.tsx` intact unless props/API of the panel itself change.

7. **Validate**
   - `pnpm test -- tests/SettingsViewAsrSetup.test.ts tests/SettingsRuntimeDependencies.test.tsx` (plus any new shell test file).
   - `pnpm build`

## Risky files / rollback points

| Area | Risk | Rollback |
|------|------|----------|
| `SettingsView.tsx` | Large UI move; easy to break Save / ASR setup / runtime cleanup | Revert settings workflow files |
| New panel files | Prop mismatch / lost handlers | Fix props or revert panels |
| `SettingsViewAsrSetup.test.ts` | Source-string tests brittle after split | Update paths/strings to match new layout |

No git history rewrite; no settings file migration.

## Review gates before `task.py start`

- [ ] User approved `prd.md`, `design.md`, and this `implement.md`
- [ ] `implement.jsonl` / `check.jsonl` curated (no seed-only `_example` rows)
- [ ] Scope still UI-only (no backend / schema work)

## Follow-up after implementation

- Run Trellis check (`trellis-check` / phase 2.2).
- Ask before any commit (project rule: no proactive commits).
