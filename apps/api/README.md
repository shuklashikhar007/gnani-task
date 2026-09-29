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

The API expects Postgres to be running. Start it from the repo root with `docker compose up -d --wait`.

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

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENV` | `development` | `production` marks the `guest_id` cookie as `Secure` (HTTPS only) |
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/audio_notes` | Postgres connection (SQLAlchemy + psycopg 3) |

- `GET /` → `{"message": "Hello World"}`
- `GET /health` → `{"status": "ok", "database": "ok"}`, or 503 if Postgres is unreachable
- `GET /whoami` → `{"guest_id": "<uuid>"}`. Issues an httponly `guest_id` cookie if missing.
- Interactive API docs: http://localhost:8000/docs

## Managing dependencies

```bash
uv add <package>      # add a dependency
uv remove <package>   # remove a dependency
```

Commit both `pyproject.toml` and `uv.lock` after changes.
