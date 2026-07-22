# Token Razor

[![CI](https://github.com/Kolikkii/token-razor/actions/workflows/ci.yml/badge.svg)](https://github.com/Kolikkii/token-razor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)

Token Razor is a local Codex plugin that reduces large tool results before they enter the model context. Compression is deterministic, uses no model call, and keeps the original result in a short-lived recovery archive.

The plugin targets a different part of the token budget than [Ponytail](https://github.com/DietrichGebert/ponytail): Ponytail guides implementation size, while Token Razor limits noisy tool output. They can be used together.

## Install

```bash
codex plugin marketplace add Kolikkii/token-razor
codex plugin add token-razor@token-razor
```

Start a new Codex thread and open `/hooks`. Codex requires review and trust whenever a non-managed hook is new or changes.

Node.js 20 or newer is required. There are no runtime package dependencies.

## Behavior

Token Razor installs six hooks:

- `UserPromptSubmit` selects a mode for the current turn when the prompt asks for one.
- `PreToolUse` rewrites only a simple oversized `cat FILE` command into a bounded read.
- `PostToolUse` compresses large text results and replaces the original model-visible result.
- `SessionStart` reports that the plugin is active.
- `PostCompact` and `Stop` prune local state.

The compressor flattens JSON into unambiguous paths, removes terminal control codes, redacts common credentials, collapses repeated variants, and scores diagnostic lines before sampling the remaining output. Failure results get 35% more space, up to the `safe` limit. Images, audio, video, small results, and explicit verbatim requests pass through unchanged.

Selected lines stay in source order. Exact rendering costs include omission markers, so a late high-priority error is not lost to a final hard truncation. If compression or storage fails, the hook exits without blocking the underlying tool.

## Modes

| Mode | Character budget | Intended use |
| --- | ---: | --- |
| `safe` | 8,500 | unfamiliar code and high-risk debugging |
| `balanced` | 6,000 | normal development work |
| `extreme` | 3,200 | repetitive output and explicit token minimization |
| `passthrough` | unlimited | verbatim output |

The current turn can request a mode in plain language. `TOKEN_RAZOR_MODE` sets an environment default, and `TOKEN_RAZOR_DISABLED=1` disables processing.

## Recovery and CLI

Compressed results include a `TR-XXXXXXXXXXXX` ID and an exact restore command when an archive is available.

```bash
node scripts/cli.mjs restore TR-XXXXXXXXXXXX
node scripts/cli.mjs preview ./large.log --mode extreme
node scripts/cli.mjs stats --json
node scripts/cli.mjs archives
node scripts/cli.mjs doctor
```

Restore only when omitted evidence is needed. A narrow rerun or file slice is usually cheaper.

## Configuration

Copy [`config.example.json`](config.example.json) to `.token-razor.json` in a workspace. A project file overrides `PLUGIN_DATA/config.json`; environment flags take precedence over both.

```json
{
  "mode": "balanced",
  "archive": {
    "enabled": true,
    "ttlHours": 24,
    "maxMiB": 64
  },
  "metricsRetentionDays": 30
}
```

See [`skills/minimize-token-usage/references/algorithms-and-configuration.md`](skills/minimize-token-usage/references/algorithms-and-configuration.md) for every setting.

## Measurement

```bash
npm run bench
```

The v0.3.0 synthetic component fixtures show a 98.9% weighted character reduction while retaining all embedded failure sentinels. This is a compressor result, not an end-to-end token or task-quality claim. See [`docs/performance.md`](docs/performance.md) for the data and [`docs/evaluation.md`](docs/evaluation.md) for a comparison protocol.

## Development

```bash
npm test
npm run validate
npm run bench
```

CI covers Node.js 20, 22, and 24 on Linux, macOS, and Windows. Contribution rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Data handling

Token Razor makes no network requests and sends no telemetry. Summaries redact common credential formats. Raw recovery archives may still contain secrets from the original output; they are local, permission-restricted where supported, protected from symlink reads, and bounded by age and size. Disable archives with `"archive": { "enabled": false }` when local retention is not acceptable.

Security reports are covered by [`SECURITY.md`](SECURITY.md). The project is licensed under [MIT](LICENSE).
