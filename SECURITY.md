# Security policy

## Supported versions

Security fixes are applied to the latest release.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose local files, secrets, recovery archives, or command execution. Use GitHub's private vulnerability reporting for this repository instead.

Include the affected version, operating system, Codex surface, reproduction steps, impact, and any suggested mitigation. Avoid attaching real credentials or sensitive archived output.

## Security model

Token Razor runs local command hooks with the user's permissions. It performs no network requests and has no telemetry. Summaries redact common credential formats, but full recovery archives intentionally preserve original tool results unless archives are disabled.

Plugin hooks are non-managed hooks. Review and trust their exact definitions through `/hooks` before enabling them, and re-review changed hook definitions after upgrades.
