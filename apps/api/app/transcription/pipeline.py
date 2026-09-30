"""Transcription steps. There is no worker process: every step runs inside an HTTP request.

What moves a recording forward:
  - /complete and /retry start it right away (quick audio is transcribed in that request);
  - Gnani's completion webhook collects a batch result as soon as the job ends;
  - the frontend's polling calls refresh, which advances the caller's due recordings (batch polls,
    retries after backoff, timeouts). A returning visitor's first refresh catches up on anything missed.

Postgres holds all state, and a row is claimed (FOR UPDATE SKIP LOCKED + lease) before any step runs,
so these triggers can overlap or repeat safely.

    uploaded ──start──► transcribing ──(sync)────────────────────────────────────► transcribed
                            └─(batch) job created+started ──poll / webhook ──► transcribed
    any step ──► failed (with a message the user can act on)
"""

import hashlib
import hmac
import logging
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import ObjectDeletedError, StaleDataError

from app.config import settings
from app.recordings import storage
from app.recordings.models import Recording, RecordingStatus, TranscriptionMode

from . import gnani
from .probe import InvalidAudio, probe_duration
from .routing import choose_mode

log = logging.getLogger(__name__)

LEASE = timedelta(minutes=5)
POLL_INTERVAL = timedelta(seconds=15)
MAX_ATTEMPTS = 5
# Gnani may take up to 30 minutes to download a file; keep the link valid well past that.
AUDIO_URL_EXPIRES = 2 * 3600

MSG_INVALID_AUDIO = "This file doesn't look like valid audio. Please check the file and upload it again."
MSG_NO_SPEECH = "No speech was detected in this audio."
MSG_FETCH_FAILED = "The transcription service couldn't fetch the file. Please retry."
MSG_REJECTED = "The transcription service rejected this file. Please retry, or try another format."
MSG_UNAVAILABLE = "The transcription service is unavailable right now. Please retry later."
MSG_TOO_LONG = "Transcription took too long and was stopped. Please retry."


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    # SQLite (used in tests) hands back naive datetimes; they are UTC.
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _lease_free(now: datetime):
    return or_(Recording.locked_until.is_(None), Recording.locked_until < now)


def _due(now: datetime):
    return or_(Recording.next_poll_at.is_(None), Recording.next_poll_at <= now)


# Rows with work to do: waiting to start, a start that died (lease expired, no job yet), or a batch job.
_NEEDS_START = or_(
    Recording.status == RecordingStatus.UPLOADED,
    and_(Recording.status == RecordingStatus.TRANSCRIBING, Recording.gnani_job_id.is_(None)),
)
_NEEDS_POLL = and_(Recording.status == RecordingStatus.TRANSCRIBING, Recording.gnani_job_id.is_not(None))


# ---- entry points ----


def _claim(db: Session, rec_id: uuid.UUID, *, ignore_schedule: bool) -> Recording | None:
    """Lock one row, take a lease on it and commit. None if it's busy, not due, or has nothing to do."""
    now = _now()
    conditions = [Recording.id == rec_id, or_(_NEEDS_START, _NEEDS_POLL), _lease_free(now)]
    if not ignore_schedule:
        conditions.append(_due(now))
    stmt = (
        select(Recording)
        .where(*conditions)
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)  # never act on a stale copy from this session
    )
    rec = db.scalars(stmt).first()
    if rec is None:
        db.rollback()  # release the row lock taken by the SELECT, if any
        return None
    rec.locked_until = now + LEASE
    db.commit()
    return rec


def advance(db: Session, rec_id: uuid.UUID, *, ignore_schedule: bool = False) -> bool:
    """Run whatever step this recording is due for. Returns False if there was nothing to do.

    `ignore_schedule` skips the wait for `next_poll_at` (used by the webhook: the job just finished).
    Never raises for Gnani/R2/ffprobe problems; those become a retry or a visible failure.
    """
    rec = _claim(db, rec_id, ignore_schedule=ignore_schedule)
    if rec is None:
        return False
    _run(db, rec, _poll if rec.gnani_job_id else _start)
    return True


def advance_due(db: Session, guest_id: str, *, max_rows: int = 5, budget_seconds: float = 10) -> int:
    """Advance this guest's due recordings, doing a bounded amount of work. Returns how many ran."""
    now = _now()
    owned = [Recording.guest_id == uuid.UUID(guest_id), _lease_free(now), _due(now)]
    # Batch polls first: they're one quick request each. Starts may transcribe quick audio inline.
    polls = db.scalars(select(Recording.id).where(*owned, _NEEDS_POLL).order_by(Recording.next_poll_at)).all()
    starts = db.scalars(select(Recording.id).where(*owned, _NEEDS_START).order_by(Recording.updated_at)).all()
    db.rollback()

    deadline = time.monotonic() + budget_seconds
    ran = 0
    for rec_id in [*polls, *starts]:
        if ran >= max_rows or time.monotonic() > deadline:
            break
        ran += advance(db, rec_id)
    return ran


# ---- webhook auth ----


def webhook_token(rec_id: uuid.UUID) -> str:
    """Secret per-recording token for Gnani's callback URL (Gnani doesn't sign its webhooks)."""
    return hmac.new(settings.webhook_secret.encode(), str(rec_id).encode(), hashlib.sha256).hexdigest()


def verify_webhook_token(rec_id: uuid.UUID, token: str) -> bool:
    return bool(settings.webhook_secret) and hmac.compare_digest(webhook_token(rec_id), token)


def _callback_url(rec_id: uuid.UUID) -> str | None:
    if not settings.public_api_url or not settings.webhook_secret:
        return None  # e.g. local development: refresh polling collects the result instead
    return f"{settings.public_api_url.rstrip('/')}/webhooks/gnani/{rec_id}?token={webhook_token(rec_id)}"


# ---- steps ----


def _start(db: Session, rec: Recording) -> None:
    if rec.status == RecordingStatus.UPLOADED:
        rec.status = RecordingStatus.TRANSCRIBING
        rec.processing_started_at = _now()
        db.commit()

    audio_url = storage.presign_get(rec.storage_key, AUDIO_URL_EXPIRES)
    try:
        rec.duration_seconds = probe_duration(audio_url)
    except InvalidAudio as exc:
        log.info("Recording %s: ffprobe failed: %s", rec.id, exc)
        _fail(db, rec, MSG_INVALID_AUDIO)
        return

    rec.transcription_mode = choose_mode(rec.duration_seconds, rec.filename, rec.language_code)
    db.commit()

    if rec.transcription_mode == TranscriptionMode.SYNC:
        audio = storage.read_bytes(rec.storage_key)
        try:
            transcript = gnani.transcribe_sync(audio, rec.filename, rec.language_code)
        except gnani.GnaniError as exc:
            if exc.code != "MAX_AUDIO_DURATION_EXCEEDED":
                raise
            # Gnani measured the audio as too long for the quick endpoint (its limit and our ffprobe
            # duration can disagree). Batch has no such limit, so fall through to it.
            log.info("Recording %s: quick endpoint said too long (%.1fs); using batch", rec.id, rec.duration_seconds)
            rec.transcription_mode = TranscriptionMode.BATCH
            db.commit()
        else:
            _finish(db, rec, transcript, segments=None)
            return

    # Save the job id before starting it: an unstarted job costs nothing, and if we crash after this
    # commit, the next poll sees status CREATED and starts it instead of creating a duplicate.
    rec.gnani_job_id = gnani.create_job(audio_url, rec.language_code, _callback_url(rec.id))
    rec.gnani_status = "CREATED"
    db.commit()
    gnani.start_job(rec.gnani_job_id)
    rec.gnani_status = "STARTING"
    rec.next_poll_at = _now() + POLL_INTERVAL
    db.commit()


def _poll(db: Session, rec: Recording) -> None:
    if _timed_out(rec):
        try:
            gnani.cancel_job(rec.gnani_job_id)
        except gnani.GnaniError:
            log.warning("Recording %s: couldn't cancel timed-out job %s", rec.id, rec.gnani_job_id)
        _fail(db, rec, MSG_TOO_LONG)
        return

    # One Gnani call per step where we already know the answer (fewer calls, fewer 429s):
    if rec.gnani_status == "CREATED":  # created but not started yet (e.g. start was rate-limited)
        gnani.start_job(rec.gnani_job_id)
        rec.gnani_status = "STARTING"
        rec.attempts = 0
        rec.next_poll_at = _now() + POLL_INTERVAL
        db.commit()
        return
    if rec.gnani_status in gnani.JOB_FINISHED_WITH_FILES:  # finished; a previous result fetch didn't complete
        _collect_result(db, rec)
        return

    job = gnani.get_job(rec.gnani_job_id)
    status = job.get("status", "")
    rec.attempts = 0  # Gnani answered, so earlier transient errors are over.

    if status in gnani.JOB_FINISHED_WITH_FILES:
        # Remember it's finished, so if fetching the result fails we skip straight to it next time.
        rec.gnani_status = status
        db.commit()
        _collect_result(db, rec)
        return
    if status in gnani.JOB_FAILED:
        log.info("Recording %s: job %s ended %s: %s", rec.id, rec.gnani_job_id, status, job)
        _fail(db, rec, MSG_REJECTED if status == "START_FAILED" else f"Transcription failed ({status.lower()}).")
        return
    if status == "CREATED":  # created but never started (e.g. crash after create_job)
        gnani.start_job(rec.gnani_job_id)
        status = "STARTING"

    rec.gnani_status = status
    rec.next_poll_at = _now() + POLL_INTERVAL
    db.commit()


def _collect_result(db: Session, rec: Recording) -> None:
    files = gnani.get_files(rec.gnani_job_id)
    if not files:
        _fail(db, rec, "Transcription finished but returned no result. Please retry.")
        return
    file = files[0]
    if file.get("status") != "COMPLETED" or not file.get("transcript_url"):
        _fail(db, rec, _file_error_message(file))
        return

    # The transcript link expires after an hour, so download it right away.
    data = gnani.download_transcript(file["transcript_url"])
    duration = data.get("duration_seconds") or file.get("duration_seconds")
    if duration:
        rec.duration_seconds = float(duration)
    rec.gnani_status = "COMPLETED"
    _finish(db, rec, data.get("full_transcript") or "", data.get("segments"))


def _file_error_message(file: dict) -> str:
    detail = (file.get("error_message") or "").lower()
    if "empty transcript" in detail or "no speech" in detail:
        return MSG_NO_SPEECH
    if file.get("status") == "SKIPPED" or "name or service" in detail or "download" in detail:
        return MSG_FETCH_FAILED
    log.info("Gnani file failure: %s", file)
    return f"Transcription failed: {file.get('error_message') or file.get('status', 'unknown error')}."


def _timed_out(rec: Recording) -> bool:
    if rec.processing_started_at is None:
        return False
    limit = max(timedelta(minutes=30), timedelta(seconds=2 * (rec.duration_seconds or 0)) + timedelta(minutes=30))
    return _now() - _aware(rec.processing_started_at) > limit


# ---- outcomes ----


def _finish(db: Session, rec: Recording, transcript: str, segments: list | None) -> None:
    if not transcript.strip():
        _fail(db, rec, MSG_NO_SPEECH)
        return
    rec.status = RecordingStatus.TRANSCRIBED
    rec.transcript = transcript.strip()
    rec.segments = segments
    rec.transcribed_at = _now()
    rec.error = None
    rec.next_poll_at = None
    rec.locked_until = None
    db.commit()


def _fail(db: Session, rec: Recording, message: str) -> None:
    rec.status = RecordingStatus.FAILED
    rec.error = message
    rec.next_poll_at = None
    rec.locked_until = None
    db.commit()


def _retry_later(db: Session, rec: Recording, reason: str) -> None:
    rec.attempts += 1
    if rec.attempts >= MAX_ATTEMPTS:
        log.warning("Recording %s: giving up after %d attempts: %s", rec.id, rec.attempts, reason)
        _fail(db, rec, MSG_UNAVAILABLE)
        return
    delay = min(timedelta(seconds=10 * 2**rec.attempts), timedelta(minutes=5))
    log.warning("Recording %s: attempt %d failed (%s); retrying in %s", rec.id, rec.attempts, reason, delay)
    rec.next_poll_at = _now() + delay
    rec.locked_until = None
    db.commit()


def _retry_after_rate_limit(db: Session, rec: Recording) -> None:
    """Gnani is busy, not broken: try again at the next poll without counting a failed attempt.
    (The overall timeout still stops a job that never gets through.)"""
    log.warning("Recording %s: Gnani rate limit; trying again in %s", rec.id, POLL_INTERVAL)
    rec.next_poll_at = _now() + POLL_INTERVAL
    rec.locked_until = None
    db.commit()


def _run(db: Session, rec: Recording, step: Callable[[Session, Recording], None]) -> None:
    """Run a step and turn any error into a retry or a visible failure. Always releases the lease."""
    try:
        try:
            step(db, rec)
        except gnani.GnaniError as exc:
            db.rollback()
            if exc.code == gnani.RATE_LIMITED:
                _retry_after_rate_limit(db, rec)
            elif exc.retryable:
                _retry_later(db, rec, exc.message)
            else:
                log.warning("Recording %s: %s", rec.id, exc.message)
                _fail(db, rec, MSG_REJECTED)
            return
        except (StaleDataError, ObjectDeletedError):
            raise
        except Exception as exc:
            db.rollback()
            log.exception("Recording %s: unexpected error", rec.id)
            _retry_later(db, rec, repr(exc))
            return
        if rec.locked_until is not None:
            rec.locked_until = None
            db.commit()
    except (StaleDataError, ObjectDeletedError):
        # The user deleted the recording while we were working on it; nothing left to do.
        db.rollback()
        log.info("Recording %s was deleted while processing", rec.id)
