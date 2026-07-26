# Architecture

Token Razor uses a deterministic five-stage path:

1. `UserPromptSubmit` chooses a per-turn mode from explicit intent.
2. `PreToolUse` rewrites only a simple oversized `cat FILE` call into a bounded local slice.
3. `PostToolUse` skips small results and compresses large results so the complete feedback envelope, including recovery metadata, stays under the active budget.
4. The original result is written to a bounded local gzip archive and referenced by content hash.
5. `Stop` and `PostCompact` perform opportunistic archive cleanup.

Compression combines exact MCP `content`/`structuredContent` deduplication, format detection, escaped JSON paths, secret redaction, long-blob hashing, normalized fingerprints, representative variant sampling, weighted signal scoring, edge retention, and coverage sampling. Raw serialization remains separate so thresholds and metrics still measure the original response. Error lines use a stricter fingerprint so distinct diagnostics are not merged only because they look similar. Signal selection happens before edge sampling, and the final renderer accounts for omission markers while retaining source order.

The CLI streams archive slices instead of loading whole files. `preview` deliberately falls back from configured `passthrough` to `balanced`, because its purpose is to show the bounded representation.

When a failure signal is present, the hook raises the active character budget by 35%, capped at the `safe` budget. Summaries that explicitly report zero failures or errors do not trigger escalation.

The PostToolUse hook returns `continue: false` with compact feedback. In current Codex hook semantics this replaces the original model-visible result without undoing tool side effects. The raw response can be retrieved through the CLI when needed.

The plugin declares no network connector or MCP server. All state lives below `PLUGIN_DATA`. Turn modes use separate files so concurrent turns do not overwrite one another. Archive writes use exclusive creation; archive and metric reads reject symbolic links. Cleanup runs after compaction and at turn completion.
