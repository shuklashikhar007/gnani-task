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

- `GET /` → `{"message": "Hello World"}`
- Interactive API docs: http://localhost:8000/docs

## Managing dependencies

```bash
uv add <package>      # add a dependency
uv remove <package>   # remove a dependency
```

Commit both `pyproject.toml` and `uv.lock` after changes.
