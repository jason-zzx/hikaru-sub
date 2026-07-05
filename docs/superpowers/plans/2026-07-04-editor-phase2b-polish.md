# Editor Phase 2B Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the editor Phase 2B polish pass: Aegisub-style time fields, editor save state, local feedback, unique cue ids, direct delete with undo, and the original 10ms precision in editor time displays.

**Architecture:** Keep behavior in small helpers. `src/utils/timeInput.ts` owns fixed-mask time editing, millisecond formatting, overflow carry, and range normalization. `src/services/editorActions.ts` owns unique cue id generation and delete-follow selection. `EditorView` owns top save state and local toast. `SubtitleEditor`, `SubtitleList`, and `useEditorHotkeys` consume those helpers.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Tailwind CSS 4, `@hikaru/ass-core`.

**Repository Rule:** Per `AGENTS.md`, do not run `git commit`, `git push`, `git merge`, `git rebase`, `git reset --hard`, or history/remote-changing commands unless the user separately gives a direct instruction.

---

## Accepted Behavior

- Time input format is `HH:MM:SS.CS` with 10ms precision.
- The fixed mask has 8 digit slots: `[0, 1, 3, 4, 6, 7, 9, 10]`.
- Number keys replace the current or next digit slot and move right.
- Backspace and Delete move the caret only; they do not delete characters.
- Arrow keys, mouse click, and Tab focus keep the browser's default caret behavior; if the caret lands on a separator, the next handled digit/Backspace/Delete operation resolves it to the adjacent digit slot.
- Paste and other DOM input changes normalize immediately to the fixed `HH:MM:SS.CS` mask; they do not simulate per-slot Aegisub keypresses.
- Minute/second overflow carries upward, e.g. `00:60:00.00` becomes `01:00:00.00`.
- Reversed ranges are normalized by clamping the changed field to the other field, without inline error.
- Save success returns the top state to `已保存`; it does not show a success toast.
- Save failure, delete, and id-generation failure use `EditorToast`.
- Left subtitle list start/end time display uses the original 10ms precision.
- ASS serialization remains unchanged; ASS dialogue timestamps are still handled by `@hikaru/ass-core`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/timeInput.ts` | Modify | `HH:MM:SS.CS` mask, 10ms parsing/formatting, overflow carry, range normalization |
| `src/utils/timeInput.test.ts` | Modify | 10ms precision, overflow carry, range clamp tests |
| `src/components/editor/SubtitleList.tsx` | Modify | Display start/end times at 10ms precision |
| `tests/SubtitleListBehavior.test.ts` | Create | Guard that subtitle list uses 10ms display |
| `src/components/editor/EditorView.tsx` | Modify | Top save state, no native `alert`, no save-success toast |
| `tests/EditorViewBehavior.test.ts` | Create/Modify | Guard save state and feedback behavior |
| `src/components/editor/SubtitleEditor.tsx` | Modify | Time mask integration, unique add/append, delete without native confirm |
| `src/hooks/useEditorHotkeys.ts` | Modify | Insert unique id, Delete direct delete + notify |
| `src/services/editorActions.ts` | Modify | Unique id helpers and delete-follow helper |
| Related tests | Modify | Keep source-level behavior guards aligned with accepted behavior |

---

### Task 1: Synchronize Documentation

- [ ] **Step 1: Update spec**

Update `docs/superpowers/specs/2026-07-04-editor-phase2b-polish-design.md` so it states:

- Time input uses `HH:MM:SS.CS`.
- Overflow carries instead of erroring.
- Reversed ranges clamp instead of blocking.
- Save success does not show a toast.
- Subtitle list displays start/end times with 10ms precision.

- [ ] **Step 2: Update this plan**

Keep this file as the current source of implementation truth. Do not leave older two-decimal or strict-error examples in this plan.

### Task 2: Time Input 10ms Precision

- [ ] **Step 1: Red tests**

Update `src/utils/timeInput.test.ts` to expect:

```typescript
expect(formatTimeInput(1234)).toBe("00:00:01.23");
expect(formatTimeInput(3723450)).toBe("01:02:03.45");
expect(formatTimeInput(400_000_000)).toBe("99:59:59.99");
expect(normalizeTimeInputValue("01020345")).toBe("01:02:03.45");
expect(parseTimeInput("01020345")).toEqual({
  ok: true,
  valueMs: 3723450,
  normalized: "01:02:03.45",
});
expect(parseTimeInput("00:60:00.00")).toEqual({
  ok: true,
  valueMs: 3600000,
  normalized: "01:00:00.00",
});
```

Run:

```bash
pnpm test -- src/utils/timeInput.test.ts
```

Expected before implementation: FAIL if the implementation still uses three decimal digits.

- [ ] **Step 2: Implement**

In `src/utils/timeInput.ts`:

- Change `TIME_INPUT_TEMPLATE` to `00:00:00.00`.
- Change digit indexes to `[0, 1, 3, 4, 6, 7, 9, 10]`.
- Normalize 8 digits, not 9.
- Parse `\.(\d{2})`, not `\.(\d{3})`.
- Convert centiseconds to milliseconds with `centiseconds * 10`.
- Clamp max to `99:59:59.99`.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm test -- src/utils/timeInput.test.ts
```

Expected: PASS.

### Task 3: Subtitle List 10ms Display

- [ ] **Step 1: Red test**

Create `tests/SubtitleListBehavior.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/SubtitleList.tsx", import.meta.url),
  ),
  "utf8",
);

describe("SubtitleList 时间显示", () => {
  it("开始/结束时间使用 10ms 精度显示", () => {
    expect(source).toContain("formatTime(cue.startMs)");
    expect(source).toContain("formatTime(cue.endMs)");
    expect(source).toContain("function formatTime");
    expect(source).not.toContain("formatPlaybackTime(cue.startMs, true)");
    expect(source).not.toContain("formatPlaybackTime(cue.endMs, true)");
  });
});
```

Run:

```bash
pnpm test -- tests/SubtitleListBehavior.test.ts
```

Expected before implementation: FAIL if `SubtitleList.tsx` still uses three-digit millisecond display.

- [ ] **Step 2: Implement**

In `src/components/editor/SubtitleList.tsx`:

- Render `{formatTime(cue.startMs)} → {formatTime(cue.endMs)}`.
- Keep a local `formatTime` helper that floors milliseconds to centiseconds.
- Do not call `formatPlaybackTime(ms, true)` for the subtitle list.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm test -- tests/SubtitleListBehavior.test.ts
```

Expected: PASS.

### Task 4: Editor Phase 2B Regression Checks

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test -- src/utils/timeInput.test.ts src/services/editorActions.test.ts src/hooks/useEditorHotkeys.test.ts tests/SubtitleEditorBehavior.test.ts tests/EditorViewBehavior.test.ts tests/SubtitleListBehavior.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manual smoke**

Verify in the editor:

- Time fields show two centisecond digits.
- Typing digits moves through all 8 digit slots.
- Backspace/Delete only move the caret.
- `00:60:00.00` normalizes to `01:00:00.00`.
- Reversed start/end fields clamp without showing an error.
- Left subtitle list shows times like `0:01.23`.
- Save success returns to `已保存` without a success toast.
- Save failure still shows an error toast.

### Task 5: Final Diff Review

- [ ] **Step 1: Check status**

Run:

```bash
git status --short
```

Expected: changes are limited to Phase 2B docs, time input/list display files, and related tests, plus any pre-existing untracked files such as `.claude/`.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff -- docs/superpowers/specs/2026-07-04-editor-phase2b-polish-design.md docs/superpowers/plans/2026-07-04-editor-phase2b-polish.md src/utils/timeInput.ts src/utils/timeInput.test.ts src/components/editor/SubtitleList.tsx tests/SubtitleListBehavior.test.ts
```

Expected: diff matches this plan and contains no unrelated refactors.
