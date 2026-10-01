"""summary fields

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUSES = ("pending_upload", "uploaded", "transcribing", "transcribed", "failed")
NEW_STATUSES = ("pending_upload", "uploaded", "transcribing", "transcribed", "summarizing", "completed", "failed")


def _status(values: tuple[str, ...]) -> sa.Enum:
    return sa.Enum(*values, name="recordingstatus", native_enum=False, length=32)


def _json() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("recordings") as t:
        t.alter_column("status", type_=_status(NEW_STATUSES), existing_type=_status(OLD_STATUSES))
        t.add_column(sa.Column("summary", _json(), nullable=True))
        t.add_column(sa.Column("summary_parts", _json(), nullable=True))
        t.add_column(sa.Column("summary_model", sa.String(200), nullable=True))
        t.add_column(sa.Column("summarized_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Rows past the old final state go back to it (their transcript is kept).
    op.execute("UPDATE recordings SET status = 'transcribed' WHERE status IN ('summarizing', 'completed')")
    with op.batch_alter_table("recordings") as t:
        for col in ("summarized_at", "summary_model", "summary_parts", "summary"):
            t.drop_column(col)
        t.alter_column("status", type_=_status(OLD_STATUSES), existing_type=_status(NEW_STATUSES))
