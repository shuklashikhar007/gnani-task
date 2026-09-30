import subprocess


class InvalidAudio(Exception):
    """ffprobe couldn't read a duration: the file is corrupt or not audio."""


def probe_duration(url: str) -> float:
    """Audio duration in seconds. Reads only what it needs over HTTP, not the whole file."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", url],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
        duration = float(out.stdout.strip())
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError) as exc:
        raise InvalidAudio(str(exc)) from exc
    if duration <= 0:
        raise InvalidAudio(f"duration is {duration}")
    return duration
