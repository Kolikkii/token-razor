# Performance

## v0.3.0 component benchmark

Measured on 2026-07-22 with Node.js 24.14.0 using `npm run bench` and the default balanced compression budget of 6,000 visible characters.

| Fixture | Original chars | Delivered chars | Reduction | Sentinel |
| --- | ---: | ---: | ---: | --- |
| Repetitive log | 365,912 | 2,787 | 99.2% | retained |
| Large JSON | 136,694 | 973 | 99.3% | retained |
| Search results | 324,270 | 5,291 | 98.4% | retained |
| **Weighted total** | **826,876** | **9,051** | **98.9%** | **all retained** |

The benchmark uses deterministic synthetic fixtures with a critical sentinel embedded away from the beginning and end of each payload. It asserts that every sentinel remains visible after compression.

## What this result means

This result measures characters delivered by the compressor before small hook metadata is added. It demonstrates behavior on highly repetitive tool output, where Token Razor is designed to have the greatest effect.

It does not measure:

- total input or output tokens for a full Codex session;
- task success, code quality, or regression rate;
- tokenization differences between models;
- the effect of archive restoration calls;
- performance on non-repetitive prose or source files.

Use [`evaluation.md`](evaluation.md) for an end-to-end comparison protocol. A plugin is only better when it reduces total tokens without reducing task completion, verification quality, or safety.
