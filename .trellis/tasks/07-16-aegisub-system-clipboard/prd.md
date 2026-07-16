# Implement mode-agnostic editing and system clipboard rows

## Goal

Make the editor a mode-agnostic ASS subtitle editor and replace its in-memory cue-row clipboard with interoperable system clipboard behavior matching Aegisub's subtitle-grid workflow. Inline/separate bilingual generation remains a translation-page concern, while the editor focuses on the single selected subtitle row and preserves native text editing inside focused text inputs.

## Background

- The editor currently keeps copied cue rows in application memory.
- Whole-row copy, cut, and paste are available from editor hotkeys and the subtitle-list context menu.
- Existing whole-row paste inserts copied rows after the active/context-menu target and assigns fresh cue IDs.
- The editor currently reads `subtitleMergeMode` in its list, text editor, video preview, and save path, switching between inline and separate bilingual presentation.
- ASS is the application's canonical subtitle exchange format.

## Requirements

- **R1 System clipboard:** Whole-row copy and cut must write plain text to the operating-system clipboard instead of an application-only clipboard.
- **R2 ASS event format:** Each copied cue must be represented as one complete ASS event line using the standard event field order, for example `Dialogue: 0,0:00:00.00,0:00:02.60,Primary,,0,0,0,,subtitle content`.
- **R3 Batch copy:** Multiple selected cues must be copied in subtitle-list order as newline-separated ASS event lines.
- **R4 Line-by-line paste:** Outside focused text inputs, each non-empty clipboard line must be processed independently in source order. A valid ASS `Dialogue:` line creates an equivalent cue with a fresh ID; an invalid line follows the plain-text fallback. Valid, plain-text, and mixed batches are inserted as one ordered block immediately after the currently selected subtitle; this insertion rule intentionally differs from Aegisub.
- **R5 Plain-text fallback:** Each non-ASS text line must create a new subtitle in the pasted block. The first fallback cue starts at the selected cue's end and has the default 2-second duration; subsequent fallback cues continue after the preceding fallback cue. Each inherits the selected cue's style and layer, stores that clipboard line as `primaryText`, and has no translation text.
- **R6 Non-text clipboard:** Outside focused text inputs, clipboard content that cannot be read as text must be ignored without modifying cues.
- **R7 Focused text inputs:** Native copy, cut, and paste behavior in text inputs must remain unchanged; whole-row handlers must not intercept those events.
- **R8 Cut safety:** Cut must remove selected cues only after their ASS text has been written successfully to the system clipboard.
- **R9 Existing edit semantics:** Successful row paste must remain undoable through the existing project-store history and select the newly pasted/created cue rows consistently with current editor behavior.
- **R10 Entry-point consistency:** Keyboard shortcuts and subtitle-list context-menu actions must use the same system clipboard and parsing behavior.
- **R11 Mode-agnostic editor:** The editor page must not branch on or load `subtitleMergeMode`; changing that setting must not alter the editor list, selected-row text form, preview, clipboard format, or save behavior.
- **R12 Single-row editing:** The selected subtitle must be edited as one ordinary subtitle row with one text field. The editor must not show separate original/translation fields or switch to an inline-specific editor.
- **R13 Translation ownership:** `subtitleMergeMode` remains effective when the translation page generates the translated ASS output; the editor must edit the generated subtitle rows without reapplying that setting.
- **R14 Physical event model:** Each physical ASS `Dialogue:` event must become one independent editor cue. Inline translation output appears as one row containing its combined text; separate translation output appears as two independently editable rows with their own text, style, timing, and selection identity.
- **R15 Editor loading:** Opening an existing subtitle, selecting an external ASS file, or entering the editor from a completed translation must load ASS events without bilingual pairing. SRT input remains one cue per SRT block.
- **R16 Editor saving:** Saving from the editor must emit exactly one `Dialogue:` event per editor cue and must not merge, split, or otherwise reinterpret rows according to `subtitleMergeMode`.
- **R17 Translation source reset:** Entering or returning to the translation page must load the original transcribed ASS as the translation source rather than using physical rows from an edited translated ASS. Existing translated files remain untouched until the user starts translation again.

## Acceptance Criteria

- [ ] Copying one selected cue places exactly one complete `Dialogue:` line on the system clipboard with its layer, times, style, margins/effect defaults, and subtitle text represented in ASS form.
- [ ] Copying multiple selected cues places newline-separated `Dialogue:` lines on the system clipboard in subtitle-list order.
- [ ] Cutting selected cues writes the same text as copying and removes the rows only when the clipboard write succeeds.
- [ ] Pasting valid single-line ASS clipboard text outside a text input inserts one equivalent cue with a fresh ID immediately after the selected row.
- [ ] Pasting valid multi-line ASS clipboard text outside a text input inserts all valid cues as one ordered block immediately after the selected row and selects the inserted rows.
- [ ] Pasting non-ASS text outside a text input inserts one cue per non-empty text line after the selected row, using consecutive 2-second ranges beginning at the selected cue's end and inheriting its style/layer.
- [ ] Pasting mixed valid ASS and ordinary text lines inserts one ordered block after the selected row; valid lines retain their modeled ASS fields and ordinary lines use the fallback fields.
- [ ] Pasting non-text/unreadable clipboard content leaves cues and selection unchanged.
- [ ] Copy, cut, and paste inside focused text inputs retain browser/WebView native behavior.
- [ ] The editor list, selected-row editor, preview, clipboard, and save path no longer read or branch on `subtitleMergeMode`.
- [ ] The selected row always has one generic subtitle text field; original/translation dual fields and inline-editor switching are absent from the editor page.
- [ ] Translation output still honors `subtitleMergeMode` when generating the translated ASS file.
- [ ] Inline translation output loads into the editor as one combined-text row per generated `Dialogue:` event.
- [ ] Separate translation output loads into the editor as independent primary- and secondary-style rows, without paired editing behavior.
- [ ] Editor save preserves the number and order of physical rows and emits one `Dialogue:` line per cue regardless of the configured translation mode.
- [ ] Returning from the editor to translation restores the transcribed ASS as source cues and does not translate already generated primary/secondary physical rows.
- [ ] Merely entering the translation page does not overwrite or delete the existing translated ASS file.
- [ ] Hotkey, context-menu, mode-agnostic editor, translation-source reset, and ASS round-trip flows are covered by focused tests, and the frontend build passes.

## Out of Scope

- Clipboard formats other than plain text.
- Copying ASS document headers, styles, attachments, or comments.
- Changing the editor's row selection model.
