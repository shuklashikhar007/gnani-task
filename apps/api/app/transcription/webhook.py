"""Gnani's batch completion webhook.

Gnani POSTs here (the `callback_url` given when the job was created) when a job ends. Its docs call
webhooks best-effort and don't sign them, so the URL carries a per-recording HMAC token, and the body
is only a wake-up call: the result is always fetched from Gnani's API by the normal poll step.
"""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from app.db import DbSession
from app.recordings.models import Recording

from . import pipeline

log = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/gnani/{recording_id}")
def gnani_job_finished(
    recording_id: uuid.UUID,
    db: DbSession,
    token: str = Query(""),
    payload: dict[str, Any] | None = Body(None),
):
    # function to verify the HMAC token sent by gnani in the header
    if not pipeline.verify_webhook_token(recording_id, token):
        raise HTTPException(status_code=403, detail="invalid token")
    # database mai recording hi nahi mili agar to 
    if db.get(Recording, recording_id) is None:
        raise HTTPException(status_code=404, detail="recording not found")
    log.info("Gnani webhook for recording %s: %s", recording_id, (payload or {}).get("event"))
    # agar sab sahi hai to verify karke agge bhej do 
    # to llm for summary generation 
    processed = pipeline.advance(db, recording_id, ignore_schedule=True)
    return {"ok": True, "processed": processed}
