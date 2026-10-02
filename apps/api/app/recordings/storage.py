"""Thin wrapper around Cloudflare R2 (S3-compatible). The only module that talks to boto3."""
# this false contains all the code related to cloudflare r2 storage service 
# the storage using chunking is also implemented in this file itself here 
from dataclasses import dataclass
from functools import cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import settings


@dataclass(frozen=True)
class UploadedPart:
    part_number: int
    size: int
    etag: str


@cache
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


def is_missing_upload(exc: ClientError) -> bool:
    return _error_code(exc) == "NoSuchUpload"


def create_multipart(key: str, content_type: str) -> str:
    res = _client().create_multipart_upload(Bucket=settings.r2_bucket, Key=key, ContentType=content_type)
    return res["UploadId"]


def presign_part(key: str, upload_id: str, part_number: int, expires: int = 3600) -> str:
    return _client().generate_presigned_url(
        "upload_part",
        Params={"Bucket": settings.r2_bucket, "Key": key, "UploadId": upload_id, "PartNumber": part_number},
        ExpiresIn=expires,
    )


def list_parts(key: str, upload_id: str) -> list[UploadedPart]:
    """All parts R2 has received so far. Raises ClientError(NoSuchUpload) if the upload is gone."""
    parts: list[UploadedPart] = []
    marker = 0
    while True:
        res = _client().list_parts(
            Bucket=settings.r2_bucket, Key=key, UploadId=upload_id, PartNumberMarker=marker
        )
        parts += [UploadedPart(p["PartNumber"], p["Size"], p["ETag"]) for p in res.get("Parts", [])]
        if not res.get("IsTruncated"):
            return parts
        marker = res["NextPartNumberMarker"]


def complete_multipart(key: str, upload_id: str, parts: list[UploadedPart]) -> None:
    _client().complete_multipart_upload(
        Bucket=settings.r2_bucket,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={"Parts": [{"PartNumber": p.part_number, "ETag": p.etag} for p in parts]},
    )


def abort_multipart(key: str, upload_id: str) -> None:
    """Abort an upload; a no-op if it's already completed or aborted."""
    try:
        _client().abort_multipart_upload(Bucket=settings.r2_bucket, Key=key, UploadId=upload_id)
    except ClientError as exc:
        if not is_missing_upload(exc):
            raise


def head_size(key: str) -> int | None:
    """Size of the stored object in bytes, or None if it doesn't exist."""
    try:
        return _client().head_object(Bucket=settings.r2_bucket, Key=key)["ContentLength"]
    except ClientError as exc:
        if _error_code(exc) in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def delete(key: str) -> None:
    _client().delete_object(Bucket=settings.r2_bucket, Key=key)


def presign_get(key: str, expires: int = 3600) -> str:
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.r2_bucket, "Key": key}, ExpiresIn=expires
    )


def read_bytes(key: str) -> bytes:
    return _client().get_object(Bucket=settings.r2_bucket, Key=key)["Body"].read()
