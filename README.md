# Audio Notes

Monorepo for the Audio Notes platform.

| Path                 | What                                | Port |
| -------------------- | ----------------------------------- | ---- |
| `apps/api`           | FastAPI backend (Python, uv)        | 8000 |
| `apps/web`           | Next.js frontend (TypeScript, pnpm) | 3000 |
| `docker-compose.yml` | PostgreSQL 17 database              | 5432 |

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Postgres)
- [uv](https://docs.astral.sh/uv/getting-started/installation/): `brew install uv`
- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/installation)
- [ffmpeg](https://ffmpeg.org/): `brew install ffmpeg` (the API uses `ffprobe` to measure audio length)

## Setup

### 1. Start the database

From the repo root:

```bash
docker compose up
```

This starts Postgres at `localhost:5432` with user `postgres`, password `postgres`, and database `audio_notes`. Data is kept in the `pgdata` Docker volume.

### 2. Start the API

```bash
cd apps/api
cp .example.env .env
uv sync
uv run alembic upgrade head # create or update the database tables
uv run fastapi dev app/main.py
```

Check it at http://localhost:8000/health. It returns `{"status": "ok", "database": "ok"}` once it can reach Postgres. The API docs are at http://localhost:8000/docs.

### 3. Start the web app

In another terminal:

```bash
cd apps/web
cp .example.env .env.local
pnpm install
pnpm dev
```

## Run everything with Docker

Instead of steps 2 and 3, you can run the API and web app in containers too (it needs `apps/api/.env`):

```bash
docker compose --profile app up --build
```

## Useful commands

```bash
docker compose --profile app down                        # stop everything (keeps data)
docker compose down                                      # stop Postgres (keeps data)
docker compose down -v                                   # stop Postgres and delete its data
docker compose exec db psql -U postgres -d audio_notes   # open a SQL shell
```

See `apps/api/README.md` and `apps/web/README.md` for more on each app.
