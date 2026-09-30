"""transcription fields

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUSES = ("pending_upload", "uploaded", "failed")
NEW_STATUSES = ("pending_upload", "uploaded", "transcribing", "transcribed", "failed")


def _status(values: tuple[str, ...]) -> sa.Enum:
    return sa.Enum(*values, name="recordingstatus", native_enum=False, length=32)


def upgrade() -> None:
    with op.batch_alter_table("recordings") as t:
        t.alter_column("status", type_=_status(NEW_STATUSES), existing_type=_status(OLD_STATUSES))
        t.add_column(sa.Column("language_code", sa.String(32), nullable=False, server_default="en-IN"))
        t.add_column(sa.Column("duration_seconds", sa.Float(), nullable=True))
        t.add_column(
            sa.Column(
                "transcription_mode",
                sa.Enum("sync", "batch", name="transcriptionmode", native_enum=False, length=8),
                nullable=True,
            )
        )
        t.add_column(sa.Column("gnani_job_id", sa.String(64), nullable=True))
        t.add_column(sa.Column("gnani_status", sa.String(32), nullable=True))
        t.add_column(sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True))
        t.add_column(sa.Column("next_poll_at", sa.DateTime(timezone=True), nullable=True))
        t.add_column(sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
        t.add_column(sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
        t.add_column(sa.Column("transcript", sa.Text(), nullable=True))
        t.add_column(sa.Column("segments", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=True))
        t.add_column(sa.Column("transcribed_at", sa.DateTime(timezone=True), nullable=True))
    # The worker looks up work by status.
    op.create_index("ix_recordings_status", "recordings", ["status"])


def downgrade() -> None:
    op.drop_index("ix_recordings_status", table_name="recordings")
    with op.batch_alter_table("recordings") as t:
        for col in (
            "transcribed_at", "segments", "transcript", "locked_until", "attempts", "next_poll_at",
            "processing_started_at", "gnani_status", "gnani_job_id", "transcription_mode",
            "duration_seconds", "language_code",
        ):
            t.drop_column(col)
        t.alter_column("status", type_=_status(OLD_STATUSES), existing_type=_status(NEW_STATUSES))
