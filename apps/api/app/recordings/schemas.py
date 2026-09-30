import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .models import RecordingStatus


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


class CreateRecordingIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int
    content_type: str = Field(default="", max_length=100)
    last_modified: int = Field(ge=0)


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
