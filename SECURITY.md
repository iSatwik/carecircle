# Security policy

CareCircle stores health information for elders, so security is treated as a core feature.

## How data is protected

- **Passcodes** are hashed with scrypt and a per-circle random salt, compared in constant time, and never returned by the API.
- **Sessions** are short-lived (12 h) signed tokens scoped to one care circle and re-checked against the member list on every request, so removed members lose access immediately.
- **Tenant isolation:** the circle is always taken from the session, never from the URL.
- **Input validation:** every write is validated with zod (unknown fields removed, lengths limited); JSON bodies are capped at 20 kB.
- **Rate limiting** on sign-in, AI, help alerts and the general API.
- **Browser hardening:** Helmet headers and a strict Content-Security-Policy with no inline scripts or styles; the front end renders data with `textContent` only.
- **Secrets** come only from environment variables. Production refuses to start without `JWT_SECRET`.
- **Dependencies** are audited in CI (`npm audit`) and kept current by Dependabot.
- The container runs as a non-root user.

## Reporting a vulnerability

Please open a private security advisory on this repository (Security → Advisories → Report a vulnerability) rather than a public issue. You will get a response within 72 hours.
