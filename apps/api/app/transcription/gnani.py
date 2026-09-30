"""Client for Gnani's speech-to-text APIs. The only module that talks to Gnani.

Docs: https://docs.gnani.ai/api/STT/speech-to-text and https://docs.gnani.ai/api/STTBatch/Introduction
"""

import threading
import time
from typing import Any

import httpx

from app.config import settings

# Batch job statuses.
JOB_RUNNING = {"CREATED", "STARTING", "QUEUED", "IN_PROGRESS"}
JOB_FINISHED_WITH_FILES = {"COMPLETED", "PARTIAL_FAILURE"}
JOB_FAILED = {"FAILED", "START_FAILED", "CANCELLED"}

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
SYNC_TIMEOUT = httpx.Timeout(120.0, connect=10.0)

RATE_LIMITED = "RATE_LIMITED"
# Gnani rate-limits its API without documenting the limit; two calls ~0.2 s apart (e.g. create then
# start) get a 429, calls a few seconds apart don't. So space our calls out, and on a 429 wait and retry
# a few times before giving up (the caller then reschedules without counting it as a failure).
MIN_CALL_SPACING_SECONDS = 1.5
RATE_LIMIT_RETRIES = 3
MAX_RATE_LIMIT_WAIT_SECONDS = 10.0

_spacing_lock = threading.Lock()
_last_call_at = 0.0


class GnaniError(Exception):
    """A failed call to Gnani. `retryable` is True for timeouts, rate limits and server errors."""

    def __init__(self, message: str, retryable: bool, code: str | None = None, retry_after: float | None = None):
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        # Gnani's error type when it sends one, e.g. "MAX_AUDIO_DURATION_EXCEEDED" or "RATE_LIMITED".
        self.code = code
        # For rate limits: how long Gnani asked us to wait, if it said.
        self.retry_after = retry_after


def _headers() -> dict[str, str]:
    return {"X-API-Key-ID": settings.gnani_api_key}


def _wait_for_turn() -> None:
    """Keep at least MIN_CALL_SPACING_SECONDS between calls from this process."""
    global _last_call_at
    with _spacing_lock:
        wait = _last_call_at + MIN_CALL_SPACING_SECONDS - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call_at = time.monotonic()


def _retry_after(res: httpx.Response, attempt: int) -> float:
    try:
        seconds = float(res.headers.get("Retry-After", ""))
    except ValueError:
        seconds = 2.0 * (attempt + 1)
    return min(max(seconds, 0.5), MAX_RATE_LIMIT_WAIT_SECONDS)


def _request(method: str, path: str, *, timeout: httpx.Timeout = TIMEOUT, **kwargs: Any) -> Any:
    url = f"{settings.gnani_base_url}{path}"
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        _wait_for_turn()
        try:
            res = httpx.request(method, url, headers=_headers(), timeout=timeout, **kwargs)
        except httpx.TimeoutException as exc:
            raise GnaniError(f"Gnani timed out ({method} {path})", retryable=True) from exc
        except httpx.TransportError as exc:
            raise GnaniError(f"Couldn't reach Gnani: {exc}", retryable=True) from exc
        if res.status_code != 429:
            break
        wait = _retry_after(res, attempt)
        if attempt == RATE_LIMIT_RETRIES:
            raise GnaniError(
                f"Gnani rate-limited {method} {path}", retryable=True, code=RATE_LIMITED, retry_after=wait
            )
        time.sleep(wait)

    if res.status_code >= 500:
        raise GnaniError(f"Gnani returned {res.status_code} for {method} {path}", retryable=True)
    if res.status_code >= 400:
        raise GnaniError(
            f"Gnani rejected {method} {path} ({res.status_code}): {res.text[:300]}",
            retryable=False,
            code=_error_code(res),
        )
    return res.json() if res.content else None


def _error_code(res: httpx.Response) -> str | None:
    """Gnani's error type. Its endpoints use different shapes:
    {"error": {"type": "..."}} (sync), {"error": "..."} (batch), {"detail": {"error_code": "..."}} (429).
    """
    try:
        body = res.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    error, detail = body.get("error"), body.get("detail")
    if isinstance(error, dict):
        return error.get("type")
    if isinstance(error, str):
        return error
    if isinstance(detail, dict):
        return detail.get("error_code")
    return None


def transcribe_sync(audio: bytes, filename: str, language_code: str) -> str:
    """Short audio (the endpoint rejects anything over 30 s): one request, transcript in the response."""
    body = _request(
        "POST",
        "/stt/v3",
        timeout=SYNC_TIMEOUT,
        files={"audio_file": (filename, audio)},
        data={"language_code": language_code},
    )
    if not body or not body.get("success"):
        raise GnaniError(f"Gnani couldn't transcribe the audio: {body}", retryable=False)
    return body.get("transcript") or ""


def create_job(audio_url: str, language_code: str, callback_url: str | None = None) -> str:
    """Create a batch job for one file. Transcription doesn't begin until `start_job`.

    With `callback_url`, Gnani POSTs there when the job ends (best-effort, per its docs).
    """
    payload: dict[str, Any] = {
        "config": {"model": settings.gnani_model, "language_code": language_code, "mode": "transcribe"},
        "source": {"type": "cloud_storage", "auth": {"mode": "public"}, "paths": [audio_url]},
    }
    if callback_url:
        payload["callback_url"] = callback_url
    return _request("POST", "/stt/v3/batch/jobs", json=payload)["job_id"]


def start_job(job_id: str) -> None:
    """Start a created job. Already started (e.g. an earlier attempt got through) counts as success."""
    try:
        _request("POST", f"/stt/v3/batch/jobs/{job_id}/start")
    except GnaniError as exc:
        if exc.code != "JOB_ALREADY_STARTED":
            raise


def get_job(job_id: str) -> dict:
    return _request("GET", f"/stt/v3/batch/jobs/{job_id}")


def get_files(job_id: str) -> list[dict]:
    return _request("GET", f"/stt/v3/batch/jobs/{job_id}/files")["data"]


def cancel_job(job_id: str) -> None:
    _request("POST", f"/stt/v3/batch/jobs/{job_id}/cancel")


def download_transcript(transcript_url: str) -> dict:
    """Fetch the transcript JSON (`full_transcript`, `segments`, ...). The URL is presigned, no API key."""
    try:
        res = httpx.get(transcript_url, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise GnaniError(f"Couldn't download the transcript: {exc}", retryable=True) from exc
    if res.status_code >= 400:
        # 403 usually means the 1-hour link expired; the next poll fetches a fresh one.
        raise GnaniError(f"Transcript download failed ({res.status_code})", retryable=True)
    return res.json()
