# Trellis on DeepSeek Harness (dsh)

dsh is a **class-2 pull-based** Trellis host. It discovers Trellis skills from
the project, uses native continuable sub-agents for isolated research,
implementation, and review roles, and exposes a stable `DSH_SESSION_ID` to each
managed shell.

| Capability | Without companion plugin | With `dsh-trellis` |
| --- | --- | --- |
| Shared and entry skills | Works | Works |
| Session-scoped active task | Works through verified `DSH_SHELL=1` + `DSH_SESSION_ID`, including nested launches | Managed per-execution identity can forward a distinct child session |
| Implement/check/research roles | Foreground native sub-agent | Background native sub-agent |
| Per-turn workflow breadcrumb | Not available | Injected from `workflow.md` |
| Event-driven child wait | Not available | `trellis_wait` |
| Utility commands | Not available | Plugin-defined commands |

## Quick start

```bash
trellis init --dsh -u your-name
dsh web        # or: dsh --profile headless "start a Trellis task for ..."
```

In dsh:

1. Describe the work in natural language and load `trellis-start` when a
   session needs explicit Trellis bootstrap.
2. The main session dispatches research, implementation, and check work through
   DSH's native `subagent` tool. Each child loads exactly one matching role
   skill: `trellis-agent-research`, `trellis-agent-implement`, or
   `trellis-agent-check`.
3. Finish through `trellis-finish-work`, preserving the project's required
   verification, commit-authorization, archive, and journal order.

## Dispatch contract

Every role dispatch prompt starts with:

```text
Active task: <exact task path>
```

Then tell the child to load the matching `trellis-agent-<role>` skill exactly
once. The main session must not load child-only role skills itself.

Before dispatching, check whether the optional `trellis_wait` tool is available:

- If available, use DSH's default continuable background mode, continue only
  independent work, then call `trellis_wait` once for each child id before the
  next dependent workflow gate.
- If unavailable, dispatch **every dependent child from the outset** with
  `run_in_background: false` so implementation/check gates cannot overtake it.

Never replace either path with shell sleep, polling loops, `job_output`, repeated
`list_agents`, or another long-running command. A continuable DSH child is an
independent Agent/Session/Inbox in the same Node.js/Cordis process, not a generic
Jobs task or an OS subprocess; its settlement arrives through the parent inbox.

## Nested host sessions

DSH inherits ordinary environment variables from the process that launches it.
If the outer process is already an active Trellis session,
`TRELLIS_CONTEXT_ID` could otherwise override the inner `DSH_SESSION_ID`. DSH
rebuilds its `DSH_*` namespace for each managed shell, so this project treats
`DSH_SHELL=1` together with a non-empty `DSH_SESSION_ID` as the current DSH
identity before an inherited generic override. The optional companion plugin may
add `DSH_TRELLIS_CONTEXT_ID` when it needs to forward a child identity different
from the shell's own session id.

## File map

- `.agents/skills/` — shared workflow and bundled skills.
- `.dsh/skills/trellis-{start,continue,finish-work}/` — DSH-private entry skills.
- `.dsh/skills/trellis-agent-{research,implement,check}/` — child-only role
  skills with pull-based task context.
- `.dsh/DSH.md` — this operator guide.
- `.trellis/` — workflow, specs, tasks, workspace journal, and shared scripts.

## Notes

- Role dispatch prompts must use the exact path returned by
  `python ./.trellis/scripts/task.py current --source`; children must not guess
  another session's task.
- Implement/check children read their JSONL manifest first, then `prd.md`, then
  optional `design.md` and `implement.md`.
- Each `dsh --profile headless` invocation creates a fresh DSH session. Keep a
  workflow in one session or explicitly resume its returned session id.
- The optional companion plugin is maintained separately and is not installed
  by this project-level backport.
