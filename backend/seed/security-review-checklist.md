---
kind: skill
title: Application security review checklist
---
# Application security review checklist

Use when reviewing a pull request or feature that handles user input, authentication, files, or external calls.

## Input and injection
- SQL: parameterised queries only; no string-built SQL. Dynamic identifiers come from an allowlist.
- Shell/commands: avoid `shell=True`; pass argument lists; validate paths against a base directory (reject `..`, resolve symlinks).
- HTML output: escape by default; no `dangerouslySetInnerHTML` / `|safe` with untrusted data; set a Content-Security-Policy.
- Deserialization: never `pickle`/`yaml.load` untrusted data; use `yaml.safe_load` and schema validation.
- SSRF: when fetching user-supplied URLs, allowlist hosts, block private and metadata IP ranges, and disable redirects or re-validate them.

## Authentication and authorization
- Every endpoint checks identity AND ownership of the specific object (IDOR). Tests must try another user's id.
- Passwords hashed with argon2/bcrypt; constant-time comparison for tokens; sessions rotated at login; cookies `HttpOnly; Secure; SameSite`.
- CSRF protection for cookie-authenticated state-changing requests; CORS origins explicit, never `*` with credentials.

## Secrets and data
- No secrets in code, logs, error messages, URLs or client bundles. Rotate any that leaked.
- Log metadata, not payloads or personal data. Encrypt sensitive data at rest where required.
- File uploads: check size, content type by sniffing, store outside the web root with generated names.

## Dependencies and infrastructure
- Pin and audit dependencies (`pip-audit`, `npm audit`); minimise container privileges (non-root user, read-only filesystem); least-privilege database roles.
- Rate limit authentication and expensive endpoints.

## Output of the review
List findings with severity, exploit scenario, file/line, and a concrete fix. Do not report style issues as security issues.
