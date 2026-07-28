# Launch kit

Copy-ready launch text for Token Razor. Replace nothing except optional channel-specific context.

## Show HN

### Title

```text
Show HN: Token Razor – Bound noisy Codex tool output before it hits context
```

### First comment

```text
I built Token Razor for a specific coding-agent problem: repetitive logs, huge JSON responses, and long search results consuming model context.

It is a local Codex plugin. A PostToolUse hook deterministically reduces large text results before they enter context, prioritizes failure signals, and stores the original in a bounded short-lived archive. Every compressed result gets a TR-ID for narrow search or full restoration. It makes no model or network calls and has no runtime package dependencies.

Install:

codex plugin marketplace add Kolikkii/token-razor
codex plugin add token-razor@token-razor

The current component benchmark reports a 99.0% weighted character reduction on deterministic synthetic repetitive-output fixtures, with all embedded failure sentinels retained.

That is intentionally a character-compression result, not a claim about token usage, cost, or task quality. The repository includes an end-to-end evaluation protocol for testing those separately.

I would especially value examples where compression hides an important detail, feedback on the recovery workflow, and real-world before/after measurements.

https://github.com/Kolikkii/token-razor
```

## Reddit

### Title

```text
I built a local Codex plugin to keep huge tool outputs out of model context
```

### Body

```text
Large coding-agent sessions can spend a surprising amount of context on repetitive logs, JSON, and search results.

Token Razor is a local Codex plugin that bounds large text tool results before Codex sees them. Compression is deterministic, uses no model call, prioritizes failures, and keeps the original in a short-lived local archive. A TR-ID lets you search a few matching lines before deciding whether to restore everything.

The current component benchmark reports a 99.0% weighted character reduction on deterministic synthetic repetitive-output fixtures, with all embedded failure sentinels retained.

Important caveat: this measures compressor output in characters. It is not a token, cost, or task-quality claim.

I am looking for adversarial fixtures and real coding tasks where it drops something important.

Repo and install instructions: https://github.com/Kolikkii/token-razor
```

## Dev.to

### Title

```text
How I bounded noisy Codex tool output without another model call
```

### Concise article draft

```text
Coding agents need command output, but they rarely need every repeated log line, JSON object, or search hit.

Token Razor is a local Codex plugin that reduces large text tool results before they enter model context. It uses deterministic heuristics instead of another LLM call: JSON becomes unambiguous paths, repeated structures are grouped, diagnostic lines are scored, and failures receive priority.

Compression remains recoverable. The original result is stored in a bounded short-lived local archive, and the compact response includes a TR-ID for narrow search or full restoration. Small and multimodal results pass through unchanged.

Install it with:

codex plugin marketplace add Kolikkii/token-razor
codex plugin add token-razor@token-razor

The current component benchmark reports a 99.0% weighted character reduction on deterministic synthetic repetitive-output fixtures, with all embedded failure sentinels retained.

That result measures compressor output in characters. It does not establish lower token usage or cost, and it says nothing about task quality. Those questions require equivalent end-to-end runs, so the repository includes an evaluation protocol rather than turning a component benchmark into a billing claim.

Try it, inspect the implementation, or bring an output that breaks it:
https://github.com/Kolikkii/token-razor
```

## X

The post below is 279 characters including the full URL.

```text
Token Razor bounds noisy Codex tool output. Deterministic and recoverable. Benchmark: 99.0% weighted character reduction on synthetic repetitive-output fixtures; all embedded failure sentinels retained. Not a token/cost/task-quality claim. https://github.com/Kolikkii/token-razor
```

## Positioning

```text
Token Razor is complementary to Ponytail and partially overlaps with RTK. Ponytail guides the agent toward smaller, necessary implementations; Token Razor does not change implementation style—it bounds noisy tool results. RTK is a command-aware CLI proxy that condenses supported command output; Token Razor sits at the Codex hook boundary and applies a final character budget to large text results processed by the hook, with TR-ID search and restoration. When pairing Token Razor with RTK, benchmark the combination because shell output may be compressed twice.
```

## Claim guardrails

Use:

```text
99.0% weighted character reduction on deterministic synthetic repetitive-output fixtures, with all embedded failure sentinels retained.
```

Do not turn that result into claims about token savings, cost savings, task quality, or superiority over Ponytail or RTK.
