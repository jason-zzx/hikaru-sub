# Hikaru Sub Subtitle Workflow

Hikaru Sub turns a working video containing Japanese speech into reviewed source-language and translated ASS subtitles, then produces subtitle-bearing media. This glossary defines the shared language for that workflow.

## Language

### Media context

**Working Video**:
The single local video currently being processed. A downloaded video or a Clip can become the Working Video.
_Avoid_: Source Video, Current File

**Video Session**:
The temporary working context that associates one Working Video with its subtitle artifacts. It is not a saved project, and changing sessions does not migrate subtitles.
_Avoid_: Project, Project File

**Clip**:
A local video derived from a selected time range of another video. A Clip is an independent media artifact and may replace the current Working Video.
_Avoid_: Segment, HLS Segment

### Subtitle model

**ASS Document**:
The complete subtitle artifact, including subtitle timing and text, script metadata, and styles. It is the durable subtitle exchange format used throughout the workflow.
_Avoid_: Project File, Cue List

**Physical Dialogue Row**:
One ASS `Dialogue:` event. After Translation writes ASS, and whenever the editor, preview, save, or Burn path loads that ASS, each Physical Dialogue Row becomes one independent Subtitle Cue. The editor does not re-pair or re-merge rows by bilingual mode.
_Avoid_: Logical Bilingual Pair (as the editor unit)

**Subtitle Cue**:
The editable unit in the editor and project store: one Physical Dialogue Row with timing, a single body text field, a style, and a layer. Multiple cues may overlap in time. During Translation's in-memory logical pass only, a cue may temporarily carry both Source Text and Translation Text before bilingual expansion into Physical Dialogue Rows.
_Avoid_: Line, ASR Segment, paired original/translation editor fields

**Source Text**:
The Japanese transcription text. On logical translation cues it is the source side; after Inline Merge expansion it is embedded in the combined Physical Dialogue Row text; after Separate Lines expansion it remains on its own Primary-style row.
_Avoid_: Original Text as a separate editor field after physical expansion

**Translation Text**:
Target-language text produced by Translation. It exists on logical translation cues, then becomes either the leading half of an Inline Merge row or its own Secondary-style Physical Dialogue Row.
_Avoid_: Secondary Text as a permanent paired field on every editor cue

**Transcribed Subtitles**:
An ASS Document produced by Transcription and containing Source Text without requiring Translation Text. Entering the Translation page always reloads this document as the translation source.
_Avoid_: Source Subtitles, Raw Subtitles

**Translated Subtitles**:
An ASS Document produced by Translation after bilingual expansion into Physical Dialogue Rows (inline combined text and/or separate Primary/Secondary dialogues). Merely opening the Translation page does not rewrite or delete this file.
_Avoid_: Translation-only Subtitles, Target Subtitles

**Active Subtitles**:
The ASS Document currently loaded for review, editing, saving, and Burn, as Physical Dialogue Rows. Translated Subtitles take precedence over Transcribed Subtitles when both are available for a Working Video.
_Avoid_: Current File, Open Subtitle

### Bilingual presentation

**Inline Merge**:
A Translation-time expansion that writes Source Text and Translation Text into one Physical Dialogue Row as `translation / source`. Applied only when generating Translated Subtitles; the editor then treats that row as ordinary single-field text.
_Avoid_: Mixed Text, Single-language Mode, editor dual-field mode

**Separate Lines**:
A Translation-time expansion that writes Source Text and Translation Text as two Physical Dialogue Rows with the same time range (Primary and Secondary styles). After expansion they are independently editable rows, not one paired cue.
_Avoid_: Split Cue as a single editor identity, Dual Cue pairing in the editor

### Workflow operations

**Transcription**:
The conversion of Japanese speech in the Working Video into timed Subtitle Cues containing Source Text.
_Avoid_: Translation, Caption Import

**Translation**:
Reading Transcribed Subtitles as source, adding Translation Text in a page-owned logical pass, then expanding with Inline Merge or Separate Lines into Physical Dialogue Rows written as Translated Subtitles for the editor and Burn.
_Avoid_: Transcription, Source Replacement, translating already expanded physical editor rows as source

**Soft Clip**:
A Clip whose boundaries may align to nearby keyframes in exchange for avoiding video re-encoding.
_Avoid_: Exact Clip

**Hard Clip**:
A Clip re-encoded to honor the selected boundaries precisely.
_Avoid_: Lossless Clip

**Burn**:
The output operation that combines the Working Video with the Active Subtitles as either Hard Subtitles or Soft Subtitles.
_Avoid_: Save, Subtitle Save

**Hard Subtitles**:
Subtitles rendered into the video image so viewers cannot disable or extract them as a separate track.
_Avoid_: Embedded Subtitle Track

**Soft Subtitles**:
An ASS subtitle track packaged with the video while remaining selectable and separate from the video image.
_Avoid_: Burned-in Subtitles
