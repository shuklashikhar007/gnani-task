import math
import mimetypes
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import PurePath

from botocore.exceptions import ClientError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.transcription import gnani, pipeline
from app.transcription.languages import LANGUAGES

from . import storage
from .models import Recording, RecordingStatus

MIB = 1024 * 1024
MIN_PART_SIZE = 10 * MIB
MAX_PARTS = 10_000
PART_URL_EXPIRES = 3600

# Formats Gnani's batch STT accepts.
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".mp4", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".webm", ".amr"}
FALLBACK_CONTENT_TYPES = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "audio/mp4", ".flac": "audio/flac",
    ".ogg": "audio/ogg", ".opus": "audio/opus", ".m4a": "audio/mp4", ".aac": "audio/aac",
    ".webm": "audio/webm", ".amr": "audio/amr",
}


class UploadError(Exception):
    """A problem the client caused or can fix; `status_code` maps it to HTTP."""

    def __init__(self, message: str, status_code: int = 400, missing_parts: list[int] | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.missing_parts = missing_parts


def compute_part_size(size_bytes: int) -> int:
    """At least 10 MiB, and large enough to stay under R2's 10,000-part limit (whole MiB)."""
    needed = math.ceil(size_bytes / MAX_PARTS)
    return max(MIN_PART_SIZE, math.ceil(needed / MIB) * MIB)


def _resolve_content_type(ext: str, content_type: str) -> str:
    content_type = content_type.strip().lower()
    if content_type.startswith("audio/") or content_type in ("video/mp4", "video/webm"):
        return content_type
    if content_type in ("", "application/octet-stream"):
        return FALLBACK_CONTENT_TYPES.get(ext) or mimetypes.guess_type(f"x{ext}")[0] or "application/octet-stream"
    raise UploadError(f"'{content_type}' is not an audio file.")


def create_recording(
    db: Session,
    guest_id: str,
    filename: str,
    size_bytes: int,
    content_type: str,
    last_modified: int,
    language_code: str = "en-IN",
) -> Recording:
    if language_code not in LANGUAGES:
        raise UploadError(f"Unsupported language '{language_code}'.")
    ext = PurePath(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(e.lstrip(".") for e in ALLOWED_EXTENSIONS))
        raise UploadError(f"Unsupported file type. Allowed: {allowed}.")
    if size_bytes <= 0:
        raise UploadError("The file is empty.")
    if size_bytes > settings.max_upload_bytes:
        raise UploadError(f"The file is too large. The limit is {settings.max_upload_bytes // MIB} MB.", 413)
    content_type = _resolve_content_type(ext, content_type)

    rec_id = uuid.uuid4()
    part_size = compute_part_size(size_bytes)
    rec = Recording(
        id=rec_id,
        guest_id=uuid.UUID(guest_id),
        filename=filename,
        content_type=content_type,
        size_bytes=size_bytes,
        file_last_modified=last_modified,
        storage_key=f"recordings/{guest_id}/{rec_id}{ext}",
        part_size=part_size,
        part_count=math.ceil(size_bytes / part_size),
        status=RecordingStatus.PENDING_UPLOAD,
        language_code=language_code,
    )
    rec.upload_id = storage.create_multipart(rec.storage_key, content_type)
    db.add(rec)
    db.commit()
    return rec


def list_recordings(db: Session, guest_id: str) -> list[Recording]:
    stmt = (
        select(Recording)
        .where(Recording.guest_id == uuid.UUID(guest_id))
        .order_by(Recording.created_at.desc())
    )
    return list(db.scalars(stmt))


def get_recording(db: Session, guest_id: str, recording_id: uuid.UUID) -> Recording:
    rec = db.get(Recording, recording_id)
    if rec is None or rec.guest_id != uuid.UUID(guest_id):
        raise UploadError("Recording not found.", 404)
    return rec


def _require_pending(rec: Recording) -> str:
    if rec.status != RecordingStatus.PENDING_UPLOAD or not rec.upload_id:
        raise UploadError(f"This recording is not accepting uploads (status: {rec.status}).", 409)
    return rec.upload_id


def presign_parts(db: Session, rec: Recording, part_numbers: list[int]) -> list[tuple[int, str]]:
    upload_id = _require_pending(rec)
    bad = [n for n in part_numbers if not 1 <= n <= rec.part_count]
    if bad:
        raise UploadError(f"Part numbers out of range 1..{rec.part_count}: {bad}")
    # Asking for URLs counts as activity, so the sweeper leaves this upload alone.
    rec.updated_at = datetime.now(UTC)
    db.commit()
    return [
        (n, storage.presign_part(rec.storage_key, upload_id, n, PART_URL_EXPIRES))
        for n in sorted(set(part_numbers))
    ]


def _fail(db: Session, rec: Recording, message: str) -> None:
    rec.status = RecordingStatus.FAILED
    rec.error = message
    rec.upload_id = None
    db.commit()


def uploaded_parts(db: Session, rec: Recording) -> list[storage.UploadedPart]:
    """Parts R2 already has (the upload checkpoints). Empty once the upload is no longer pending."""
    if rec.status != RecordingStatus.PENDING_UPLOAD or not rec.upload_id:
        return []
    try:
        return storage.list_parts(rec.storage_key, rec.upload_id)
    except ClientError as exc:
        if storage.is_missing_upload(exc):
            _fail(db, rec, "The upload expired before it finished. Please upload the file again.")
            return []
        raise


def _expected_size(rec: Recording, part_number: int) -> int:
    if part_number < rec.part_count:
        return rec.part_size
    return rec.size_bytes - rec.part_size * (rec.part_count - 1)


def _mark_uploaded(db: Session, rec: Recording) -> Recording:
    rec.status = RecordingStatus.UPLOADED
    rec.error = None
    rec.upload_id = None
    rec.uploaded_at = datetime.now(UTC)
    db.commit()
    # Start transcribing now, in this request: quick audio comes back transcribed; long audio gets its
    # batch job created (so Gnani's webhook can finish it even if the user closes the tab).
    pipeline.advance(db, rec.id)
    return rec


def complete_upload(db: Session, rec: Recording) -> Recording:
    """Finalize using R2's own list of parts. Safe to call more than once."""
    if rec.uploaded_at is not None:
        # Already finished (and maybe already being transcribed): a retried request succeeds.
        return rec
    upload_id = _require_pending(rec)

    try:
        parts = storage.list_parts(rec.storage_key, upload_id)
    except ClientError as exc:
        if not storage.is_missing_upload(exc):
            raise
        # The upload is gone: either a previous /complete finished on R2 but not in our DB,
        # or it was aborted. The stored object tells us which.
        if storage.head_size(rec.storage_key) == rec.size_bytes:
            return _mark_uploaded(db, rec)
        _fail(db, rec, "The upload expired before it finished. Please upload the file again.")
        raise UploadError("The upload expired before it finished.", 409) from exc

    by_number = {p.part_number: p for p in parts}
    missing = [n for n in range(1, rec.part_count + 1) if n not in by_number]
    if missing:
        raise UploadError(f"{len(missing)} part(s) are still missing.", 409, missing_parts=missing)

    # A part with the wrong size means the client sent a different or truncated file chunk;
    # asking for it again is the fix.
    wrong = [n for n in range(1, rec.part_count + 1) if by_number[n].size != _expected_size(rec, n)]
    if wrong:
        raise UploadError(f"{len(wrong)} part(s) have the wrong size.", 409, missing_parts=wrong)

    ordered = [by_number[n] for n in range(1, rec.part_count + 1)]
    storage.complete_multipart(rec.storage_key, upload_id, ordered)

    actual = storage.head_size(rec.storage_key)
    if actual != rec.size_bytes:
        storage.delete(rec.storage_key)
        _fail(db, rec, "The uploaded file was incomplete. Please upload it again.")
        raise UploadError("The uploaded file size doesn't match.", 422)
    return _mark_uploaded(db, rec)


def retry_transcription(db: Session, rec: Recording) -> Recording:
    """Retry a failed recording: just the summary if a transcript exists, otherwise transcription.

    Only possible if its file was uploaded.
    """
    if rec.status != RecordingStatus.FAILED or rec.uploaded_at is None:
        raise UploadError("Only a failed recording whose upload finished can be retried.", 409)
    rec.error = None
    rec.next_poll_at = None
    rec.attempts = 0
    rec.locked_until = None
    if rec.transcript:
        # Transcription already succeeded; only the summary failed. Redo just that.
        rec.status = RecordingStatus.TRANSCRIBED
        rec.summary = None
        rec.summary_parts = None
        db.commit()
        pipeline.advance(db, rec.id)
        return rec
    rec.status = RecordingStatus.UPLOADED
    rec.transcription_mode = None
    rec.gnani_job_id = None
    rec.gnani_status = None
    rec.processing_started_at = None
    db.commit()
    pipeline.advance(db, rec.id)
    return rec


def delete_recording(db: Session, rec: Recording) -> None:
    if rec.status == RecordingStatus.TRANSCRIBING and rec.gnani_job_id:
        try:
            gnani.cancel_job(rec.gnani_job_id)
        except gnani.GnaniError:
            pass  # best effort: the job's result is simply never collected
    if rec.upload_id:
        storage.abort_multipart(rec.storage_key, rec.upload_id)
    storage.delete(rec.storage_key)  # no-op if the object doesn't exist
    db.delete(rec)
    db.commit()


def sweep_stale_uploads(db: Session, guest_id: str | None = None) -> int:
    """Abort uploads with no activity for `upload_stale_hours` and mark them failed."""
    cutoff = datetime.now(UTC) - timedelta(hours=settings.upload_stale_hours)
    stmt = select(Recording).where(Recording.status == RecordingStatus.PENDING_UPLOAD, Recording.updated_at < cutoff)
    if guest_id is not None:
        stmt = stmt.where(Recording.guest_id == uuid.UUID(guest_id))
    stale = db.scalars(stmt).all()
    for rec in stale:
        if rec.upload_id:
            storage.abort_multipart(rec.storage_key, rec.upload_id)
        _fail(db, rec, "Upload was abandoned before finishing.")
    return len(stale)


def refresh(db: Session, guest_id: str) -> list[Recording]:
    """Move this guest's recordings forward (called by the frontend's polling), then list them."""
    sweep_stale_uploads(db, guest_id)
    pipeline.advance_due(db, guest_id)
    return list_recordings(db, guest_id)


def refresh_one(db: Session, rec: Recording) -> Recording:
    """Move one recording forward if it's due. `rec` is updated in place."""
    pipeline.advance(db, rec.id)
    db.refresh(rec)
    return rec
