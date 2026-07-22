# Contributing

## Development setup

Token Razor has no package dependencies. Install Node.js 20 or newer, clone the repository, and run:

```bash
npm test
npm run validate
npm run bench
```

## Pull requests

- Keep hook behavior deterministic and local-first.
- Preserve fail-open behavior: optimization failures must not block user work.
- Add tests for every compression, retention, redaction, or hook-schema change.
- Do not claim end-to-end token savings from the synthetic component benchmark.
- Keep public documentation and plugin metadata in English.
- Avoid runtime dependencies unless they solve a measured problem.

Describe what changed, why it matters, and which checks you ran.
