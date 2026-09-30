import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app import guest, recordings
from app.db import DbSession, SessionLocal
from app.recordings.service import sweep_stale_uploads

log = logging.getLogger(__name__)
SWEEP_INTERVAL_SECONDS = 15 * 60


def _sweep_once() -> None:
    with SessionLocal() as db:
        swept = sweep_stale_uploads(db)
    if swept:
        log.info("Marked %d stale upload(s) as failed", swept)


async def _sweep_forever() -> None:
    # Temporary home: this moves into the background worker once it exists.
    while True:
        try:
            await asyncio.to_thread(_sweep_once)
        except Exception:
            log.exception("Stale upload sweep failed")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_sweep_forever())
    yield
    task.cancel()


app = FastAPI(title="Audio Notes API", lifespan=lifespan)
app.add_exception_handler(recordings.UploadError, recordings.upload_error_handler)
app.include_router(guest.router)
app.include_router(recordings.router)


@app.get("/")
def hello():
    return {"message": "Hello World"}


@app.get("/health")
def health(db: DbSession):
    try:
        db.execute(text("SELECT 1"))
    except OperationalError:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ok", "database": "ok"}
