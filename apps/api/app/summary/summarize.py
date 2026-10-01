"""Prompts, transcript chunking and parsing for summaries. No I/O here."""

import json
import re

from pydantic import BaseModel, Field, ValidationError, field_validator

SYSTEM_PROMPT = (
    "You summarize transcripts of audio recordings. Always write in English, even if the transcript is in "
    "another language or mixes languages. Only use information that is in the transcript; never invent details. "
    "Transcripts come from speech recognition, so expect some misheard words and fix obvious ones silently."
)

JSON_INSTRUCTIONS = """Return ONLY a JSON object, no markdown, with exactly these keys:
{
  "title": "a short title for the recording, at most 8 words",
  "overview": "2-4 sentences: what the recording is about and its main outcome",
  "key_points": ["the most important points, each one sentence", "..."],
  "action_items": ["tasks, decisions to follow up or commitments mentioned; [] if there are none"]
}"""


class Summary(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    overview: str = Field(min_length=1)
    key_points: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)

    @field_validator("key_points", "action_items")
    @classmethod
    def _drop_blank(cls, items: list[str]) -> list[str]:
        return [i.strip() for i in items if isinstance(i, str) and i.strip()]


class InvalidSummary(Exception):
    """The model's reply wasn't the JSON we asked for (worth asking again)."""


def split_transcript(text: str, max_chars: int) -> list[str]:
    """Split into chunks of at most `max_chars`, preferring sentence ends, never mid-word."""
    text = text.strip()
    chunks: list[str] = []
    while len(text) > max_chars:
        window = text[:max_chars]
        cut = max(window.rfind(". "), window.rfind("? "), window.rfind("! "), window.rfind("। "))
        if cut < max_chars // 2:  # no sentence end in the second half: fall back to a word boundary
            cut = window.rfind(" ")
        if cut <= 0:  # a single enormous "word": hard cut
            cut = max_chars - 1
        chunks.append(text[: cut + 1].strip())
        text = text[cut + 1 :].strip()
    if text:
        chunks.append(text)
    return chunks


def summary_messages(transcript: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Summarize this transcript.\n\n{JSON_INSTRUCTIONS}\n\nTranscript:\n{transcript}"},
    ]


def part_notes_messages(part: str, index: int, total: int) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"This is part {index} of {total} of a long transcript. Write concise English bullet-point notes "
                "of everything important in this part (topics, facts, decisions, tasks, names, numbers). "
                f"Notes only, no introduction.\n\nTranscript part {index}/{total}:\n{part}"
            ),
        },
    ]


def combine_messages(notes: list[str]) -> list[dict[str, str]]:
    joined = "\n\n".join(f"Notes for part {i}:\n{n}" for i, n in enumerate(notes, 1))
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "These are notes taken from consecutive parts of one long recording. "
                f"Summarize the whole recording.\n\n{JSON_INSTRUCTIONS}\n\n{joined}"
            ),
        },
    ]


def parse_summary(reply: str) -> Summary:
    """Parse the model's reply, tolerating code fences or text around the JSON object."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", reply.strip(), flags=re.IGNORECASE)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise InvalidSummary("no JSON object in the reply")
    try:
        return Summary.model_validate(json.loads(text[start : end + 1]))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise InvalidSummary(str(exc)[:200]) from exc
