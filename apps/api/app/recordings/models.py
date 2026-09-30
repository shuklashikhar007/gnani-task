import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Enum, Float, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RecordingStatus(enum.StrEnum):
    PENDING_UPLOAD = "pending_upload"
    UPLOADED = "uploaded"
    TRANSCRIBING = "transcribing"
    TRANSCRIBED = "transcribed"
    FAILED = "failed"


class TranscriptionMode(enum.StrEnum):
    SYNC = "sync"
    BATCH = "batch"


def _str_enum(cls: type[enum.StrEnum], length: int) -> Enum:
    return Enum(cls, native_enum=False, length=length, values_callable=lambda e: [m.value for m in e])


class Recording(Base):
    __tablename__ = "recordings"
    __table_args__ = (
        Index("ix_recordings_guest_created", "guest_id", "created_at"),
        Index("ix_recordings_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    guest_id: Mapped[uuid.UUID]

    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    # The browser's File.lastModified (ms). With filename + size, lets us match a file on resume.
    file_last_modified: Mapped[int] = mapped_column(BigInteger)

    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    # R2 multipart upload id; cleared once the upload is completed or aborted.
    upload_id: Mapped[str | None] = mapped_column(String(1024))
    part_size: Mapped[int] = mapped_column(BigInteger)
    part_count: Mapped[int]

    status: Mapped[RecordingStatus] = mapped_column(
        _str_enum(RecordingStatus, 32), default=RecordingStatus.PENDING_UPLOAD
    )
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # ---- transcription (see app/transcription/pipeline.py) ----
    # Gnani language code(s), e.g. "en-IN" or "hi-IN,en-IN".
    language_code: Mapped[str] = mapped_column(String(32), default="en-IN", server_default="en-IN")
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    transcription_mode: Mapped[TranscriptionMode | None] = mapped_column(_str_enum(TranscriptionMode, 8))
    gnani_job_id: Mapped[str | None] = mapped_column(String(64))
    # Latest batch job status from Gnani (CREATED, QUEUED, IN_PROGRESS, ...), shown as progress in the UI.
    gnani_status: Mapped[str | None] = mapped_column(String(32))
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # When this row is next due for work (batch poll, or retry after a transient error).
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Transient failures so far; drives backoff and the give-up limit.
    attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    # Lease: while in the future, another request won't process this row (set when a step claims it).
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    transcript: Mapped[str | None] = mapped_column(Text)
    segments: Mapped[list | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"))
    transcribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
