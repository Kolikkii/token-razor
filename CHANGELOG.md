# Changelog

All notable changes to Token Razor are documented here.

## [0.3.0] - 2026-07-22

### Added

- Deterministic mixed-output fuzz tests and regression coverage for malformed configuration, concurrent turns, archive expiry, shell parsing, and exact output budgets.
- Redaction for private keys, GitLab and npm tokens, Google API keys, and JWTs.

### Changed

- Prioritized diagnostic signals before boundary sampling and removed the final hard-truncation path.
- Escaped ambiguous JSON keys and bounded JSON flattening work.
- Isolated mode state by turn and tightened archive, metric, and recovery path handling.
- Simplified repository copy and implementation comments.

### Fixed

- Prevented malformed nested configuration from disabling hooks.
- Prevented unquoted multi-file `cat` commands from being rewritten as one path.
- Kept late critical lines when omission markers consume part of the output budget.
- Prevented expired or size-pruned archives from returning unusable recovery IDs.
- Made test discovery independent of shell glob expansion on Windows.

## [0.2.0] - 2026-07-22

### Added

- Git-backed Codex marketplace metadata for direct repository installation.
- Failure-aware output budgets and representative normalized-variant sampling.
- GitHub, Slack, and additional credential redaction patterns.
- Metrics retention, JSON statistics, local compression previews, and package validation.
- Cross-platform CI and automated tagged release packaging.

### Changed

- Rewrote all public-facing repository documentation in English.
- Hardened archive creation and restoration against symlink and race attacks.
- Expanded publisher and repository metadata in the plugin manifest.

## [0.1.0] - 2026-07-22

- Initial Codex plugin with adaptive PostToolUse compression, recovery archives, CLI tooling, and a bundled token-efficiency skill.
