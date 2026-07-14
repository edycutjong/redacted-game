# Security Policy

## Supported Versions
| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## Scope
REDACTED is a Devvit Web app running on the Reddit developer platform. In
addition to normal application code (`src/`, `tools/case-compiler/`), the
security-relevant surface includes:

- **Truth leakage** — no endpoint should ever return undealt shard text or any
  `truth` field before it is meant to be revealed (invariant I2, enforced by
  `serialize.ts`).
- **Redis schema** — this app must never introduce plain Redis lists/sets outside
  the hash/zset schema documented in `README.md`.
- **`devvit.json` permissions** — `http.enable` must stay `false`; any change
  that enables outbound HTTP or widens `reddit.asUser` scopes is a security-review
  item, not a routine PR.

## Reporting a Vulnerability
Please **do not** open a public issue for security vulnerabilities. Instead,
report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after
triage. Please give us a reasonable window to patch before public disclosure.
