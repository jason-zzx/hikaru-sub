# Recommended unified editor history architecture

## Scope of this research

This document recommends the minimum frontend seams needed to satisfy the approved PRD. It does not propose ASS-model, persistence, backend, or `StyleManager` history changes.

## Current evidence

### History and save state

- `projectStore` owns cue history as raw `SubtitleCue[][]` snapshots (`src/stores/projectStore.ts:6-9,20,50`).
- `replaceCues`, `updateCue`, `addCue`, and `deleteCue` each append the current cue array and clear `future` (`src/stores/projectStore.ts:136-164,183-203`). `replaceCues` is already the correct one-call seam for batch edits.
- `updateCuePreview` changes the live cue list and dirty flag without recording a baseline (`src/stores/projectStore.ts:166-181`). This is why blur-time `updateCue` usually sees no change.
- `undo` and `redo` restore only cues and force `isDirty: true`; they have no saved-revision identity or editing context (`src/stores/projectStore.ts:252-279`). `markSaved` is only a boolean reset (`src/stores/projectStore.ts:281-282`).
- Session replacement and ASS loading already clear history (`src/stores/projectStore.ts:81-91,98-121`) and should continue to establish a fresh base revision.

### Selection and caret ownership

- Active cue and cue multi-selection live in `playbackStore`, separately from cue history (`src/stores/playbackStore.ts:3-18,21-44`). `setSelectedCueIds` makes the last retained id active.
- Playback time, play state, and segment stop are in the same store but are explicitly excluded by the PRD. History restoration must update only `selectedCueId` and `selectedCueIds`, not call `selectCueAndSeek`.
- `SubtitleEditor` owns local text/time drafts and the textarea DOM ref (`src/components/editor/SubtitleEditor.tsx:75-92`). It currently stores a focus baseline only for Escape (`src/components/editor/SubtitleEditor.tsx:112-132,365-392`).
- Text input previews on every change, while blur/Enter attempt a later commit (`src/components/editor/SubtitleEditor.tsx:127-132,156-203`). Time fields remain local until blur or Enter (`src/components/editor/SubtitleEditor.tsx:162-173,194-200,407-440`).
- Single-row inline formatting calls the preview path and then restores the textarea selection asynchronously (`src/components/editor/SubtitleEditor.tsx:248-306,337-357`). It therefore also needs a real discrete project-history commit.

### Command entry points

- Undo/redo hotkeys are `outside-input`, while `findHotkey` already rejects composition events (`src/components/editor/hotkeys.ts:85-87,119-146`).
- The hotkey actions call `projectStore.undo/redo` directly (`src/hooks/useEditorHotkeys.ts:203-204`).
- Playback buttons receive those same raw store methods from `EditorView` (`src/components/editor/EditorView.tsx:304-310`). A shared command wrapper is required if a focused draft must be committed before either entry point runs.
- Timeline drag already previews outside the store and calls `updateCue` once on pointer-up (`src/components/editor/Timeline.tsx:323-347`), so it already has correct one-item semantics.
- Row cut/paste/batch actions compute one cue list and call `replaceCues` once before applying their resulting selection (`src/hooks/useEditorHotkeys.ts:64-78,120-152`; `src/components/editor/SubtitleList.tsx:76-88,185-212`). This contract must remain unchanged.

### Existing test seams

- `projectStore.test.ts:117-167` covers cue no-ops and preview-without-history; these expectations must be revised for grouped live commits while retaining focus/blur no-op behavior.
- `projectStore.test.ts:169-205` covers one-item `replaceCues` behavior.
- `hotkeys.test.ts:67-71` explicitly asserts that focused inputs bypass project undo; this must invert while the existing IME guard remains.
- `useEditorHotkeys.test.ts` already exercises project undo/redo and one-step multi-row replacement, but currently expects selection to remain untouched rather than snapshot restoration.
- There is no focused `SubtitleEditor` component test, so IME, `beforeinput`, draft flushing, and caret restoration currently have no integration coverage.

## Recommended minimum data model

Replace raw cue arrays in history with state snapshots while keeping history owned by `projectStore`:

```ts
type TextSelection = {
  cueId: string;
  start: number;
  end: number;
  direction?: "forward" | "backward" | "none";
};

type EditorContextSnapshot = {
  activeCueId: string | null;
  selectedCueIds: string[];
  textSelection: TextSelection | null;
};

type HistorySnapshot = {
  revision: number;
  cues: SubtitleCue[];
  context: EditorContextSnapshot;
};
```

`HistoryState` should additionally keep:

- `currentRevision` and a monotonic `nextRevision`;
- `savedRevision` plus a non-history document-dirty epoch/flag for out-of-scope style-library changes and explicit `markDirty` calls;
- `activeTextGroup` metadata for coalescing;
- current text-selection context and a restore nonce/pending selection for the textarea;
- the existing bounded `past`/`future` arrays.

A distinct revision is assigned only when a new history item begins. Further input coalesced into that item retains the same current revision and amends the current cue state. This is essential for the 50-item bound.

### Save-checkpoint rules

- `markSaved` must record the revision actually serialized, not blindly mark the latest store state clean.
- Capture a save token containing the current cue revision and non-history dirty epoch immediately before file I/O. After successful I/O, record that token as the saved checkpoint. If editing continued during the await, the current revision remains dirty.
- Saving terminates the active text group. Otherwise typing after a save could amend the saved revision and incorrectly remain clean.
- Undo/redo computes `isDirty` by comparing the current token with the saved token. A new branch uses a new monotonic revision, so an unreachable saved revision cannot accidentally become clean.
- `StyleManager` actions remain outside undo history but must keep a separate non-history dirty flag/epoch. Cue undo must never clear that flag. Successful save clears/records it.
- `setSession`, `clearSession`, and normal `loadAssDocument` establish a clean base revision. The existing external-import flow may call `markDirty` afterward to invalidate that base checkpoint.

## Recommended mutation seam

Centralize cue-history bookkeeping in one private `projectStore` mutation helper, then keep the public operations (`updateCue`, `replaceCues`, `addCue`, `deleteCue`) as thin callers. The helper should:

1. reject no-op cue results;
2. snapshot the current cues and editing context;
3. append one bounded `past` state, assign a new revision, and clear `future` for a normal edit;
4. clear `activeTextGroup` for every non-text cue operation;
5. compute dirty state from the saved token.

Do not change batch call sites to per-row updates. Their one `replaceCues` call is already the required atomic history action.

For editing context, the least invasive cross-store seam is:

- capture active/multi-selection directly from `usePlaybackStore.getState()` when a snapshot is made;
- keep only current textarea selection/pending restoration in the history owner;
- during undo/redo, filter snapshot ids against restored cues and set only `selectedCueId`/`selectedCueIds` in `playbackStore` (direct state update is preferable because `setSelectedCueIds` always derives the active id);
- choose active id in this order: valid snapshot active id, last valid selected id, first restored cue, `null`;
- never touch `currentTimeMs`, `isPlaying`, or `playUntilMs`;
- expose a restore nonce so `SubtitleEditor` applies `setSelectionRange` after the selected cue and controlled text have rendered, without continually fighting normal user selection.

This one-way `projectStore -> playbackStore` access has no current circular dependency and avoids duplicating cue selection as authoritative state.

## Aegisub-style text grouping

Add one small pure helper (for example `src/services/editorTextHistory.ts`) rather than embedding all classification branches in the React component. It should accept the `beforeinput` operation, pre/post selection, cue id, and timestamp, and return whether to continue the active group.

Recommended group metadata:

```ts
type TextGroupKind = "insert" | "backspace" | "delete";

type ActiveTextGroup = {
  cueId: string;
  kind: TextGroupKind;
  caret: number;
  lastInputAt: number;
  revision: number;
};
```

Classification rules:

- `insertText` and a committed composition insertion coalesce only when the pre-edit selection is collapsed, the insertion begins at the previous group's resulting caret, cue ids match, and idle time is less than 30 seconds.
- `deleteContentBackward` coalesces only for a collapsed selection whose pre-edit caret equals the previous resulting caret and whose post-edit caret moved backward.
- `deleteContentForward` coalesces only for a collapsed selection at the same resulting caret.
- insertion, Backspace, and Delete are separate kinds.
- any selection replacement, `insertFromPaste`, `deleteByCut`, unrecognized `inputType`, non-contiguous position, cue switch, inline-format action, or other cue mutation starts a new group.
- safe fallback for missing/unknown `inputType` is a discrete history item, never accidental coalescing.
- inject/pass the timestamp to the pure helper so the 30-second boundary is deterministic under fake timers.

On the first event of a group, push the current snapshot and assign a revision. On compatible events, update cues/context without pushing or clearing history again. Text changes then remain live and immediately undoable while the textarea is focused.

### IME

Do not trust `insertCompositionText` as a committed operation across WebView/browser variants.

- On composition start, capture a transient baseline snapshot and pre-composition selection.
- During composition `onChange`, update the live preview only; do not push/amend project history.
- On composition end, promote the transient baseline exactly once and classify the final committed value as an insertion. Suppress an immediately following identical input event if the WebView emits both.
- If composition is cancelled, restore/discard the transient baseline without adding history.
- Keep `findHotkey`'s existing `isComposing` early return so undo/redo is never routed mid-composition.

The transient baseline is necessary because preview writes otherwise overwrite the only value that can be pushed as the undo state.

### Inline formatting

Single-row tag/alignment operations should stop calling the preview-only path. Compute the next text exactly as today, terminate any typing group, and call one normal `updateCue` so each formatting command is a discrete history item. Keep the existing asynchronous caret restoration and also update the history-owned text-selection context. Batch formatting must continue to call `replaceCues` once.

## Focused draft flushing before commands

The textarea is already live in project history, but start/end time and quick font-size controls keep local drafts until blur. A global undo invoked while one of those inputs is focused would otherwise undo an older project action while leaving a conflicting local draft visible.

Use one shared `runHistoryCommand` wrapper for hotkeys and playback buttons:

1. mark only persisted-draft inputs with a data attribute;
2. if one is active, blur it to run its existing validation/commit;
3. schedule undo/redo after that synchronous Zustand commit (a microtask is sufficient, but verify event ordering in jsdom/WebView2);
4. otherwise execute immediately.

Pass these wrappers into both `useEditorHotkeys` and `PlaybackControls`; stop having `buildEditorActions` reach directly into `projectStore` for undo/redo. Use the same flush boundary before save so the saved revision matches the visible validated timing/font-size draft. Do not blur/commit transient font-search or filter drafts.

Changing only the hotkey scope is insufficient. The shared wrapper is what makes keyboard and button behavior data-equivalent.

## Cue-switch and operation boundaries

Cue id mismatch prevents cross-cue coalescing, but switching away and back to the same cue within 30 seconds could otherwise continue an old group. Explicitly end the group when active cue selection changes. A lightweight subscription in the history owner or an editor-level selection effect is sufficient; it must run synchronously enough that switching away and back cannot reuse the old group.

Normal project mutations, inline formatting, cut/paste, Enter commit/navigation, and save must also end the active group even when their data result is a no-op. A no-op still creates no snapshot.

## Escape and blur contract

This is the highest implementation-risk behavior because the current textarea is a preview draft until blur, while the approved design makes text edits live history immediately.

Recommended compatibility behavior:

- blur ends the active text group and performs no duplicate cue commit;
- Enter ends the group, commits any timing draft, then performs the existing next-cue/append behavior;
- Escape during a timing draft restores store values and blurs as today;
- Escape during composition cancels the transient composition baseline without history;
- ordinary textarea Escape should preserve the current product meaning of “discard draft”: restore the focus baseline and remove text-history groups created by that focus session as though they never happened.

The last rule requires a small store-managed text-session checkpoint (baseline cues/revision plus prior past/future references) rather than recording the discard as another edit. It is the only way to preserve redo branches and saved-state correctness when Escape follows an edit after undo. If product accepts redefining Escape to “end edit and blur,” this checkpoint can be omitted, but that would be a behavior change and should not be made silently.

## Rejected shortcuts

- **Make undo hotkeys global only:** project history still lacks text entries and focused timing drafts remain inconsistent.
- **Call `updateCue` on every character:** consumes full cue snapshots per character and defeats the 50-item history.
- **Use a focus session as the only group:** contradicts approved Aegisub-style insertion/Backspace/Delete grouping.
- **Keep browser-native textarea undo and synchronize afterward:** two authorities cannot preserve chronological ordering with cue-list operations or toolbar buttons.
- **Put all playback state in snapshots:** violates the PRD and would make undo unexpectedly seek/pause.
- **Include `assStyles` in history:** widens scope into `StyleManager`; use a non-history dirty epoch instead.
- **Rely on button blur ordering without a shared command wrapper:** keyboard and button paths can diverge, especially for timing drafts and async save.
- **Compare whole cue lists to determine saved state:** adds repeated deep comparisons and still misses out-of-history style changes; revision tokens are smaller and deterministic.

## Test plan and risks

### Pure/store tests

- insertion, Backspace, and Delete runs coalesce independently;
- operation type, cue, non-contiguous caret, selection replacement, paste/cut, formatting, other cue edit, save, and 30-second idle break the group;
- first grouped edit clears redo; later coalesced edits do not add entries;
- no-op operations add no entries;
- undo/redo restore snapshot cues, active cue, filtered multi-selection, and text selection while playback time/play state/segment stop remain unchanged;
- deletion/restore fallback selection is valid for middle, last, and only cue;
- save checkpoint becomes clean on exact revision, remains dirty off it, remains dirty after saved future is abandoned, and remains dirty when a non-history style edit exists;
- saving mid-group ends coalescing;
- bounded history still behaves at 50 entries;
- `replaceCues` remains one entry for batch formatting/cut/paste.

### Component/hotkey tests

- focused textarea/time/number inputs match project undo/redo; IME-composing keydown does not;
- normal typing previews immediately and is undoable before blur;
- composition previews but records only the final committed insertion once;
- time draft is committed before keyboard undo and before playback-button undo, producing identical data;
- caret/selection is applied after undo/redo without forcing video seek;
- focus/blur with no edit remains clean and adds no history;
- Enter, blur, cue switch, inline formatting, and Escape follow the explicit boundaries above.

### Residual risks to validate manually

- WebView2 event order and `InputEvent.inputType` values for Japanese IME can differ from jsdom; manually test composition commit/cancel and the possible post-`compositionend` duplicate input.
- React blur batching must be verified for the microtask command wrapper; if a microtask is too early in the packaged WebView, use one animation frame rather than duplicating commit logic.
- Controlled textarea rerenders may move the caret before the restore effect; restoration needs a nonce/pending flag, not an unconditional selection effect.
- Async save must pair serialized cues and revision from one store read; otherwise a later edit can be falsely marked saved.
- Existing tests construct raw `{ past: [], future: [] }` history fixtures. The migration should provide a reusable reset helper or update every fixture consistently rather than accepting partially initialized history.
