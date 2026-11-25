"""Workshop worker who opened each repair case, kept to the end of the job.

Set when the worker presses «Realizza lavoro»; existing cases start empty.

Revision ID: 0038_case_mechanic
Revises: 0037_staff_documents
"""
from alembic import op
import sqlalchemy as sa

revision = "0038_case_mechanic"
down_revision = "0037_staff_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("repair_cases", sa.Column("mechanic_id", sa.Uuid(), nullable=True))
    op.add_column("repair_cases", sa.Column("mechanic_assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_repair_cases_mechanic_id", "repair_cases", ["mechanic_id"])


def downgrade() -> None:
    op.drop_index("ix_repair_cases_mechanic_id", table_name="repair_cases")
    op.drop_column("repair_cases", "mechanic_assigned_at")
    op.drop_column("repair_cases", "mechanic_id")
