import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field

from .models import RecordingStatus, TranscriptionMode


class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    file_last_modified: int
    part_size: int
    part_count: int
    status: RecordingStatus
    error: str | None
    created_at: datetime
    updated_at: datetime
    uploaded_at: datetime | None
    language_code: str
    duration_seconds: float | None
    transcription_mode: TranscriptionMode | None
    gnani_status: str | None
    attempts: int
    processing_started_at: datetime | None
    transcribed_at: datetime | None
    summarized_at: datetime | None
    # Only needed to compute summary_progress; not sent.
    summary_parts: list | None = Field(default=None, exclude=True)

    @computed_field
    @property
    def summary_progress(self) -> dict | None:
        """{"done": 2, "total": 5} while a long transcript is summarized part by part."""
        if not self.summary_parts:
            return None
        return {"done": sum(p is not None for p in self.summary_parts), "total": len(self.summary_parts)}


class SummaryOut(BaseModel):
    title: str
    overview: str
    key_points: list[str]
    action_items: list[str]


class RecordingDetailOut(RecordingOut):
    transcript: str | None
    segments: list[dict] | None
    summary: SummaryOut | None


class CreateRecordingIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int
    content_type: str = Field(default="", max_length=100)
    last_modified: int = Field(ge=0)
    language_code: str = Field(default="en-IN", max_length=32)


class PresignPartsIn(BaseModel):
    part_numbers: list[int] = Field(min_length=1, max_length=50)


class PresignedPart(BaseModel):
    part_number: int
    url: str


class PresignPartsOut(BaseModel):
    parts: list[PresignedPart]
    expires_in: int


class UploadedPartOut(BaseModel):
    part_number: int
    size: int


class UploadProgressOut(BaseModel):
    parts: list[UploadedPartOut]
    uploaded_bytes: int
