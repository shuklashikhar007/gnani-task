import uuid

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from app.db import DbSession
from app.guest import GuestId

from . import service
from .schemas import (
    CreateRecordingIn,
    PresignedPart,
    PresignPartsIn,
    PresignPartsOut,
    RecordingDetailOut,
    RecordingOut,
    UploadedPartOut,
    UploadProgressOut,
)

router = APIRouter(prefix="/recordings", tags=["recordings"])


def upload_error_handler(_: Request, exc: service.UploadError) -> JSONResponse:
    body: dict = {"detail": exc.message}
    if exc.missing_parts is not None:
        body["missing_parts"] = exc.missing_parts
    return JSONResponse(status_code=exc.status_code, content=body)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_recording(body: CreateRecordingIn, db: DbSession, guest_id: GuestId) -> RecordingOut:
    rec = service.create_recording(
        db, guest_id, body.filename, body.size_bytes, body.content_type, body.last_modified, body.language_code
    )
    return RecordingOut.model_validate(rec)


@router.post("/refresh")
def refresh_recordings(db: DbSession, guest_id: GuestId) -> list[RecordingOut]:
    """List this guest's recordings after advancing any due transcription work (polled by the UI)."""
    return [RecordingOut.model_validate(r) for r in service.refresh(db, guest_id)]


@router.get("")
def list_recordings(db: DbSession, guest_id: GuestId) -> list[RecordingOut]:
    return [RecordingOut.model_validate(r) for r in service.list_recordings(db, guest_id)]


@router.get("/{recording_id}")
def get_recording(recording_id: uuid.UUID, db: DbSession, guest_id: GuestId) -> RecordingDetailOut:
    return RecordingDetailOut.model_validate(service.get_recording(db, guest_id, recording_id))


@router.post("/{recording_id}/refresh")
def refresh_recording(recording_id: uuid.UUID, db: DbSession, guest_id: GuestId) -> RecordingDetailOut:
    rec = service.get_recording(db, guest_id, recording_id)
    return RecordingDetailOut.model_validate(service.refresh_one(db, rec))

# not able to get a res from postman on the routes below this comment 
@router.post("/{recording_id}/parts")
def presign_parts(
    recording_id: uuid.UUID, body: PresignPartsIn, db: DbSession, guest_id: GuestId
) -> PresignPartsOut:
    rec = service.get_recording(db, guest_id, recording_id)
    urls = service.presign_parts(db, rec, body.part_numbers)
    return PresignPartsOut(
        parts=[PresignedPart(part_number=n, url=u) for n, u in urls],
        expires_in=service.PART_URL_EXPIRES,
    )


@router.get("/{recording_id}/parts")
def get_uploaded_parts(recording_id: uuid.UUID, db: DbSession, guest_id: GuestId) -> UploadProgressOut:
    rec = service.get_recording(db, guest_id, recording_id)
    parts = service.uploaded_parts(db, rec)
    return UploadProgressOut(
        parts=[UploadedPartOut(part_number=p.part_number, size=p.size) for p in parts],
        uploaded_bytes=sum(p.size for p in parts),
    )


@router.post("/{recording_id}/complete")
def complete_upload(recording_id: uuid.UUID, db: DbSession, guest_id: GuestId) -> RecordingOut:
    rec = service.get_recording(db, guest_id, recording_id)
    return RecordingOut.model_validate(service.complete_upload(db, rec))


@router.post("/{recording_id}/retry")
def retry_transcription(recording_id: uuid.UUID, db: DbSession, guest_id: GuestId) -> RecordingOut:
    rec = service.get_recording(db, guest_id, recording_id)
    return RecordingOut.model_validate(service.retry_transcription(db, rec))


@router.delete("/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recording(recording_id: uuid.UUID, db: DbSession, guest_id: GuestId) -> None:
    rec = service.get_recording(db, guest_id, recording_id)
    service.delete_recording(db, rec)
