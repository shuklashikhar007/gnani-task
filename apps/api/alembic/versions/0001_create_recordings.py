"""create recordings

Revision ID: 0001
Revises:
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recordings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("guest_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("file_last_modified", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=False, unique=True),
        sa.Column("upload_id", sa.String(1024), nullable=True),
        sa.Column("part_size", sa.BigInteger(), nullable=False),
        sa.Column("part_count", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending_upload", "uploaded", "failed", name="recordingstatus", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_recordings_guest_created", "recordings", ["guest_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_recordings_guest_created", table_name="recordings")
    op.drop_table("recordings")
