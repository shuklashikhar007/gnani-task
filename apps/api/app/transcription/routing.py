from pathlib import PurePath

from app.config import settings
from app.recordings.models import TranscriptionMode

# Formats Gnani's synchronous endpoint accepts (batch accepts more).
SYNC_EXTENSIONS = {".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a"}


def choose_mode(duration_seconds: float, filename: str, language_code: str) -> TranscriptionMode:
    """Sync is faster (no job queue, no polling) but only takes short audio, some formats and one language."""
    fits_sync = (
        duration_seconds <= settings.sync_max_seconds
        and PurePath(filename).suffix.lower() in SYNC_EXTENSIONS
        and "," not in language_code
    )
    return TranscriptionMode.SYNC if fits_sync else TranscriptionMode.BATCH
