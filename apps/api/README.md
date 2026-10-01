# API

FastAPI backend for the Audio Notes platform.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`brew install uv` on macOS)

uv installs the right Python version automatically (see `.python-version`).

## Setup

```bash
cd apps/api
uv sync
```

This creates `.venv/` and installs all dependencies from `uv.lock`.

Copy the example env file and adjust it if needed:

```bash
cp .example.env .env
```

The API expects Postgres to be running. Start it from the repo root with `docker compose up -d --wait`. Then create the tables:

```bash
uv run alembic upgrade head
```

## Run

Development (auto-reload):

```bash
uv run fastapi dev app/main.py
```

Production:

```bash
uv run fastapi run app/main.py
```

The server starts on http://localhost:8000.

Transcription needs `ffmpeg` installed and `GNANI_API_KEY` set. It runs inside API requests (no worker): `/complete` starts it, `POST /recordings/refresh` (polled by the web app) advances due work, and `POST /webhooks/gnani/{id}` collects finished batch jobs. Once a transcript is ready, the next refresh generates an English summary with an LLM.

Summaries use any OpenAI-compatible Chat Completions API: set `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` for OpenAI, Gemini, Anthropic, Groq, OpenRouter or a local Ollama (see `.example.env` for base URLs).

| Variable                                    | Default                                                             | Purpose                                                           |
| ------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ENV`                                       | `development`                                                       | `production` marks the `guest_id` cookie as `Secure` (HTTPS only) |
| `DATABASE_URL`                              | the docker-compose Postgres (`localhost:5432`)                      | Postgres connection; when set (e.g. Supabase) it's always used    |
| `R2_ACCOUNT_ID`                             |                                                                     | Cloudflare account ID                                             |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` |                                                                     | R2 API token with Object Read & Write                             |
| `R2_BUCKET`                                 |                                                                     | Bucket that holds uploaded audio                                  |
| `MAX_UPLOAD_BYTES`                          | `2147483648` (2 GiB)                                                | Largest file accepted                                             |
| `UPLOAD_STALE_HOURS`                        | `24`                                                                | Unfinished uploads idle this long are aborted and marked `failed` |
| `GNANI_API_KEY`                             |                                                                     | Gnani speech-to-text API key                                      |
| `GNANI_BASE_URL`                            | `https://api.vachana.ai`                                            | Gnani API base URL                                                |
| `GNANI_MODEL`                               | `gnani-prisma-v2.5`                                                 | Model for batch transcription jobs                                |
| `SYNC_MAX_SECONDS`                          | `25`                                                                | Audio up to this long uses the quick endpoint; longer uses batch  |
| `PUBLIC_API_URL`                            |                                                                     | Public API base URL for Gnani's webhook; empty disables it        |
| `WEBHOOK_SECRET`                            |                                                                     | Random secret that signs webhook URLs                             |
| `LLM_BASE_URL`                              | `https://api.openai.com/v1`                                         | OpenAI-compatible API base URL for summaries                      |
| `LLM_API_KEY`                               |                                                                     | API key for that provider (not needed for local Ollama)           |
| `LLM_MODEL`                                 |                                                                     | Model name; summaries are off until this is set                   |
| `LLM_JSON_MODE`                             | `false`                                                             | Ask for JSON output mode (if the provider supports it)            |
| `LLM_TIMEOUT_SECONDS`                       | `90`                                                                | Timeout per LLM request                                           |
| `LLM_CHUNK_CHARS`                           | `24000`                                                             | Longer transcripts are summarized in parts, then combined         |

## Database migrations

```bash
uv run alembic upgrade head                            # apply migrations
uv run alembic revision --autogenerate -m "message"    # after changing models
```

## Managing dependencies

```bash
uv add <package>      # add a dependency
uv remove <package>   # remove a dependency
```

Commit both `pyproject.toml` and `uv.lock` after changes.
