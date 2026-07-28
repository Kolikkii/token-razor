# Algorithms and configuration

## Pipeline

Token Razor runs entirely on the local machine and uses no model call:

1. Skip small responses and explicit passthrough turns.
2. Normalize ANSI/control sequences and collapse long base64 blobs.
3. Redact common credential forms in model-visible summaries.
4. Replace an exact MCP `content[].text` duplicate of `structuredContent` with one reference while retaining independent content blocks.
5. Flatten valid JSON into stable path/value evidence, sampling oversized arrays across the full range while explicitly scanning for failures.
6. Fingerprint lines after normalizing timestamps, IDs, numbers, repeated JSON fields, and source-search locations.
7. Collapse repeated and structurally equivalent lines while keeping counts and representative samples.
8. Score errors, failures, warnings, summaries, diffs, tests, paths, head, and tail.
9. Select high-value signals first, then boundary and coverage samples.
10. Render the selection under an exact budget that includes omission markers and hook recovery metadata.
11. Save the original response in a private, gzip-compressed, short-lived local archive that supports bounded literal search before full-output delivery.

The archive is deliberately retrieval-on-demand: the model sees a small identifier, not the full payload. Files are permission-restricted where the operating system supports it and pruned by age and total size.

## Configuration precedence

Highest precedence wins:

1. `TOKEN_RAZOR_DISABLED=1` and `TOKEN_RAZOR_MODE`
2. `<workspace>/.token-razor.json`
3. `${PLUGIN_DATA}/config.json`
4. built-in defaults

Copy `config.example.json` from the plugin root for the supported shape.

## Defaults

| Setting | Default | Meaning |
| --- | ---: | --- |
| `smallResponseChars` | 4000 | Baseline below which responses pass through unchanged. |
| `budgets.safe` | 8500 | Conservative model-visible character budget. |
| `budgets.balanced` | 6000 | Default character budget. |
| `budgets.extreme` | 3200 | Aggressive character budget. |
| `archive.ttlHours` | 24 | Maximum archive age. |
| `archive.maxMiB` | 64 | Maximum archive storage. |
| `largeCatBytes` | 80000 | Size above which a simple `cat FILE` is rewritten. |
| `largeCatLines` | 240 | Lines returned by the first safe slice. |
| `metricsRetentionDays` | 30 | Maximum age of local daily metrics files. |

Compression also requires the source to exceed the active budget by at least 1,200 characters, preventing hook metadata from making medium responses larger. Failure signals increase the active budget by 35% up to the safe ceiling. Multimodal image, audio, and video results always pass through.

## Privacy

No telemetry or network access exists. Archive files are created exclusively, recovery refuses symbolic links, and retention is bounded. The full-output archive can still contain secrets that appeared in tool output. Disable it with `archive.enabled: false` for sensitive environments; summaries remain redacted, but disabled archives cannot be restored.
