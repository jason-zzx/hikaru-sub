# Code Reuse Thinking Guide

> **Purpose**: Stop and think before creating new code - does it already exist?

---

## The Problem

**Duplicated code is the #1 source of inconsistency bugs.**

When you copy-paste or rewrite existing logic:
- Bug fixes don't propagate
- Behavior diverges over time
- Codebase becomes harder to understand

---

## Before Writing New Code

### Step 1: Search First

```bash
# Search for similar function names
grep -r "functionName" .

# Search for similar logic
grep -r "keyword" .
```

### Step 2: Ask These Questions

| Question | If Yes... |
|----------|-----------|
| Does a similar function exist? | Use or extend it |
| Is this pattern used elsewhere? | Follow the existing pattern |
| Could this be a shared utility? | Create it in the right place |
| Am I copying code from another file? | **STOP** - extract to shared |

---

## Common Duplication Patterns

### Pattern 1: Copy-Paste Functions

**Bad**: Copying a validation function to another file

**Good**: Extract to shared utilities, import where needed

### Pattern 2: Similar Components

**Bad**: Creating a new component that's 80% similar to existing

**Good**: Extend existing component with props/variants

### Pattern 3: Repeated Constants

**Bad**: Defining the same constant in multiple files

**Good**: Single source of truth, import everywhere

### Pattern 4: Repeated Payload Field Extraction

**Bad**: Multiple consumers cast the same JSON/event fields locally:

```typescript
const description = (ev as { description?: string }).description;
const context = (ev as { context?: ContextEntry[] }).context;
```

This is duplicated contract logic even when the code is only two lines. Each
consumer now has its own definition of what a valid payload means.

**Good**: Put the decoder, type guard, or projection next to the data owner:

```typescript
if (isThreadEvent(ev)) {
  renderThreadEvent(ev);
}
```

**Rule**: If the same untyped payload field is read in 2+ places, create a
shared type guard / normalizer / projection before adding a third reader.

---

## When to Abstract

**Abstract when**:
- Same code appears 3+ times
- Logic is complex enough to have bugs
- Multiple people might need this

**Don't abstract when**:
- Only used once
- Trivial one-liner
- Abstraction would be more complex than duplication

---

## After Batch Modifications

When you've made similar changes to multiple files:

1. **Review**: Did you catch all instances?
2. **Search**: Run grep to find any missed
3. **Consider**: Should this be abstracted?

### Reducers Should Use Exhaustive Structure

When state is derived from action-like values (`action`, `kind`, `status`,
`phase`), prefer a reducer with one `switch` over scattered `if/else` updates.

```typescript
// BAD - action-specific state transitions are hard to audit
if (action === "opened") { ... }
else if (action === "comment") { ... }
else if (action === "status") { ... }

// GOOD - one reducer owns the transition table
switch (event.action) {
  case "opened":
    ...
    return;
  case "comment":
    ...
    return;
}
```

This matters when the event log is the source of truth. A reducer is the
documented replay model; display code and commands should not duplicate pieces
of that replay model.

---

## Checklist Before Commit

- [ ] Searched for existing similar code
- [ ] No copy-pasted logic that should be shared
- [ ] No repeated untyped payload field extraction outside a shared decoder
- [ ] Constants defined in one place
- [ ] Similar patterns follow same structure
- [ ] Reducer/action transitions live in one reducer or command dispatcher

---

## Hikaru-Specific Reuse Traps

### Trap 1: Font discovery and Tauri invokes

**Bad**: Calling `discoverPreviewFonts` / `invoke("discover_preview_fonts")` from multiple components.

**Good**: `getPreviewFonts` singleton (`src/services/previewFontDiscovery.ts`) + `usePreviewFontNames({ enabled })`. Product commands go through `src/services/tauri.ts`.

### Trap 2: Bilingual ASS display / serialize

**Bad**: Ad-hoc `primaryText` / `secondaryText` formatting in list, editor, and player.

**Good**: `getCueDisplay` + `serializeAss({ mergeMode })` from `src/lib/ass/` with `settings.subtitleMergeMode`.

### Trap 3: Dual ASR service trees

Repo-root `asr-service/` (dev) and `src-tauri/resources/asr-service/` (packaged template) can drift. When changing engine/API behavior, search **both** trees and keep release sync intentional.

### Trap 4: Job pollers vs page effects

**Bad**: Copying clip/burn finalize logic into each workflow view.

**Good**: One App-level poller (`useClipJobPoller` / `useBurnJobPoller` in `AppLayout`) plus the matching Zustand job store.

---

## Gotcha: Engine / status string switches

ASR engines and job statuses are stringly typed across Python and TypeScript. Adding a new engine id or status without updating every `if`/`match`/`switch` silently falls through to a wrong default.

**Prevention**: When adding an engine or status value, search both `asr-service/` and `src/` / `src-tauri/` for the existing ids (and the packaged copy under `src-tauri/resources/asr-service/`). Prefer a single registry/list where one already exists (see `asr-service/engines/`).
