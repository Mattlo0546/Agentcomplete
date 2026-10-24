---
kind: skill
title: Docker multi-stage builds for Python and Node apps
---
# Docker multi-stage builds for Python and Node apps

Use when writing or optimising a Dockerfile for production images.

## Pattern
Build in one stage with compilers and dev tools, copy only the artifacts into a slim runtime stage.
```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY app ./app

FROM python:3.12-slim AS runtime
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/v1/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Rules
- Order layers from least to most frequently changing: dependency manifests first, then source, so dependency layers stay cached.
- Use BuildKit cache mounts for package managers and `.dockerignore` to exclude `.git`, `node_modules`, `.venv`, `.env` and tests.
- Run as a non-root user; no secrets in `ENV`, `ARG` or layers - use runtime env vars or build secrets (`--mount=type=secret`).
- Pin base image versions (and digests for reproducibility); prefer `-slim` or distroless; use `exec` form for `CMD` so signals reach the process.
- Node: stage 1 `npm ci` + build, stage 2 copy `.next/standalone` or `dist` and production dependencies only (`npm ci --omit=dev`).
- Scan images (`trivy`) in CI and rebuild regularly for patches.
