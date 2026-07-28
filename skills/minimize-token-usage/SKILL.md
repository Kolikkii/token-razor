---
name: minimize-token-usage
description: Reduce Codex context and token use while preserving evidence and correctness. Use for long coding, research, debugging, repository exploration, noisy logs, large command or MCP outputs, repeated file reads, cost-sensitive work, or when the user asks for concise, cheap, low-token, or context-efficient execution. Also use when Token Razor emits a TR archive identifier that may need selective restoration.
---

# Minimize Token Usage

Treat context as a budget. Preserve decisions, constraints, failures, and verification evidence; discard repetition and low-signal bulk.

## Work economically

1. Inspect narrowly with `rg`, targeted line ranges, and exact files.
2. Reuse evidence already in the thread. Do not reread unchanged content.
3. Batch independent reads only when every result is likely to matter.
4. Prefer summaries, counts, and diffs over full listings.
5. Keep progress and final prose proportional to the request.
6. Verify risky changes; token savings never justify skipping relevant tests.

## Handle compressed results

Token Razor labels a compacted tool result with a `TR-XXXXXXXXXXXX` identifier. Use the visible summary first. Restore the full result only when omitted evidence blocks the next decision:

```bash
node "/installed/token-razor/scripts/cli.mjs" restore TR-XXXXXXXXXXXX --data-dir "/plugin/data/path"
```

Copy the exact command from the compacted result; it contains the current installation and data paths. Prefer a fresh narrow query over restoring a huge archive when the missing fact is known. Never invent omitted content.

When the result advertises a `search` command, use it before printing the full archive:

```bash
node "/installed/token-razor/scripts/cli.mjs" search TR-XXXXXXXXXXXX "decisive literal" --context 3 --data-dir "/plugin/data/path"
```

## Select a mode

- `balanced`: default; compress large tool output aggressively while retaining signals.
- `safe`: larger output budget for unfamiliar or high-risk debugging.
- `extreme`: smallest budget for repetitive logs, broad searches, and explicit token minimization.
- `passthrough`: use only when the user asks for verbatim or unabridged output.

The prompt hook recognizes these intents per turn. Persistent project overrides belong in `.token-razor.json`; see [algorithms-and-configuration.md](references/algorithms-and-configuration.md) only when tuning or auditing behavior.

## Guard correctness

- Preserve error messages, failing assertions, exit status, summaries, changed paths, and boundary lines.
- Restore or rerun narrowly if the summary contains omission markers around decisive evidence.
- Do not use a token claim as proof of task quality. Compare equivalent tasks and verification outcomes.
