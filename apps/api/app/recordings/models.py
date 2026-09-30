import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RecordingStatus(enum.StrEnum):
    PENDING_UPLOAD = "pending_upload"
    UPLOADED = "uploaded"
    FAILED = "failed"


class Recording(Base):
    __tablename__ = "recordings"
    __table_args__ = (Index("ix_recordings_guest_created", "guest_id", "created_at"),)

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
        Enum(RecordingStatus, native_enum=False, length=32, values_callable=lambda e: [m.value for m in e]),
        default=RecordingStatus.PENDING_UPLOAD,
    )
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
