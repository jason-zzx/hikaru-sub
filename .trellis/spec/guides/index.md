# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

Global hard rules for this repo: [`/AGENTS.md`](/AGENTS.md). Layer specs: `frontend/`, `tauri/`, `asr/`.

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning React / Tauri / ASR |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Feature touches React UI **and** a Tauri command **and/or** the ASR sidecar
- [ ] You are adding or changing a Tauri command (Rust ↔ `tauri.ts` ↔ types)
- [ ] ASS parse/serialize, `SubtitleCue`, or `subtitleMergeMode` behavior changes
- [ ] `VideoSession` paths, clip replace, or work-cache layout changes
- [ ] Job progress/cancel must survive navigating away from a workflow page
- [ ] Runtime dependency probe/measure/cleanup or portable paths are involved
- [ ] You're not sure whether logic belongs in React, Rust, or Python
- [ ] UI / command code starts casting raw invoke or HTTP payload fields locally

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places (types + Rust + Python)
- [ ] **You're modifying any constant or config**
- [ ] **You're creating a new utility/helper function** ← Search first!
- [ ] Two files read the same untyped payload field with local casts
- [ ] You're about to call `discoverPreviewFonts` / `invoke` instead of existing singletons/wrappers
- [ ] You're duplicating `getCueDisplay` / bilingual merge logic outside `src/lib/ass/`

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When Verifying AI Cross-Review Results

- [ ] Reviewer claims "user input can be malicious" → Check the actual data source (bundled manifest? user path? external URL?)
- [ ] Reviewer flags "missing validation" → Is the data from a trusted internal source?
- [ ] Reviewer says "behavior change" → Read the code comments — is it intentional design?
- [ ] Reviewer identifies a "bug" in test → Mentally delete the feature being tested — does the test still pass? If yes → tautological test

**Common AI reviewer false-positive patterns**:
1. **Trust boundary confusion**: Treating internal data (bundled JSON manifests) as untrusted external input
2. **Ignoring design comments**: Flagging intentional behavior documented in code comments as bugs
3. **Variable misreading**: Not tracing a variable to its actual definition

**Verification rule**: Every CRITICAL/WARNING finding must be verified against the actual code before prioritizing.

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
rg "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs — especially ASS merge mode, command names, and camelCase snapshot fields.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide + the owning layer `index.md`
2. **During coding**: If something feels repetitive or cross-layer, check the guides
3. **After bugs**: Capture durable rules into `.trellis/spec/<layer>/` or `/AGENTS.md` when truly global

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
