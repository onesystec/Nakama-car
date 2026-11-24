"""Workshop expenses (Spese Nakama Car) for the Costi officina page.

Revision ID: 0035_workshop_expenses
Revises: 0034_estimate_line_markup
"""
from alembic import op
import sqlalchemy as sa

revision = "0035_workshop_expenses"
down_revision = "0034_estimate_line_markup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workshop_expenses",
        sa.Column("id", sa.Uuid(), primary_key=True),  # pk_workshop_expenses
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("category", sa.String(20), nullable=False, server_default="ALTRO"),
        sa.Column("area", sa.String(12), nullable=False, server_default="GENERAL"),
        sa.Column("supplier", sa.String(160)),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_workshop_expenses_tenant_id", "workshop_expenses", ["tenant_id"])
    op.create_index("ix_workshop_expenses_expense_date", "workshop_expenses", ["expense_date"])


def downgrade() -> None:
    op.drop_index("ix_workshop_expenses_expense_date", table_name="workshop_expenses")
    op.drop_index("ix_workshop_expenses_tenant_id", table_name="workshop_expenses")
    op.drop_table("workshop_expenses")
