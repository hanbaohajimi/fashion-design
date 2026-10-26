FROM ghcr.io/astral-sh/uv:0.8.22 AS uv
FROM python:3.11-slim-bookworm AS base
COPY --from=uv /uv /uvx /usr/local/bin/
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
COPY LICENSE README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

FROM base AS test
COPY tests ./tests
RUN uv sync --frozen
CMD ["python", "-m", "pytest", "-q", "-m", "not integration"]

FROM base AS runtime
RUN useradd --create-home --uid 10001 runway && mkdir -p /tmp/runway && chown runway:runway /tmp/runway
USER runway
CMD ["fashion-runway", "worker"]
