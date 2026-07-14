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

**Subtitle Cue**:
The editable subtitle unit for one time range, with Source Text, optional Translation Text, a style, and a layer. Multiple cues may overlap in time.
_Avoid_: Line, ASR Segment

**Source Text**:
The Japanese transcription carried by a Subtitle Cue. Translation retains this text rather than replacing it.
_Avoid_: Original Text, Primary Text

**Translation Text**:
The optional target-language translation attached to the same Subtitle Cue as its Source Text.
_Avoid_: Secondary Text, Translated Source

**Transcribed Subtitles**:
An ASS Document produced by Transcription and containing Source Text without requiring Translation Text.
_Avoid_: Source Subtitles, Raw Subtitles

**Translated Subtitles**:
An ASS Document produced by Translation and containing both Source Text and Translation Text where translation succeeded.
_Avoid_: Translation-only Subtitles, Target Subtitles

**Active Subtitles**:
The ASS Document currently loaded for review, editing, saving, and Burn. Translated Subtitles take precedence over Transcribed Subtitles when both are available for a Working Video.
_Avoid_: Current File, Open Subtitle

### Bilingual presentation

**Inline Merge**:
A bilingual presentation in which Translation Text and Source Text share one dialogue as `translation / source`. It changes presentation, not the meaning of the two text fields.
_Avoid_: Mixed Text, Single-language Mode

**Separate Lines**:
A bilingual presentation in which Source Text and Translation Text become separate dialogues with the same time range. It changes presentation, not the underlying Subtitle Cue.
_Avoid_: Split Cue, Dual Cue

### Workflow operations

**Transcription**:
The conversion of Japanese speech in the Working Video into timed Subtitle Cues containing Source Text.
_Avoid_: Translation, Caption Import

**Translation**:
The addition of target-language Translation Text to existing Subtitle Cues while preserving their Source Text and timing.
_Avoid_: Transcription, Source Replacement

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
