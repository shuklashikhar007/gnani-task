# FastAPI backend. Also used for one-off migrations: `alembic upgrade head`.
FROM python:3.14-slim

# ffprobe (from ffmpeg) measures audio length before transcription.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 1001 app && chown -R app /app
USER app

ENV PATH="/app/.venv/bin:$PATH" \
    PORT=8000
EXPOSE 8000

# PORT is set by Cloud Run; defaults to 8000 elsewhere.
CMD ["sh", "-c", "fastapi run app/main.py --host 0.0.0.0 --port ${PORT}"]
