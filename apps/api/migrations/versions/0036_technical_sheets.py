"""Technical sheet per model + engine and engine code on vehicles.

Revision ID: 0036_technical_sheets
Revises: 0035_workshop_expenses
"""
from alembic import op
import sqlalchemy as sa

revision = "0036_technical_sheets"
down_revision = "0035_workshop_expenses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vehicles", sa.Column("engine_code", sa.String(40)))
    op.create_table(
        "technical_sheets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("model_key", sa.String(255), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(40), nullable=False, server_default="officina"),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "model_key", name="uq_technical_sheets_tenant_key"),
    )
    op.create_index("ix_technical_sheets_tenant_id", "technical_sheets", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_technical_sheets_tenant_id", table_name="technical_sheets")
    op.drop_table("technical_sheets")
    op.drop_column("vehicles", "engine_code")
