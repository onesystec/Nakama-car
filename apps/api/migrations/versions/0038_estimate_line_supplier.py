"""Supplier of each estimate line (where the part was bought), internal only.

Revision ID: 0038_estimate_line_supplier
Revises: 0037_staff_documents
"""
from alembic import op
import sqlalchemy as sa

revision = "0038_estimate_line_supplier"
down_revision = "0037_staff_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("estimate_lines", sa.Column("supplier", sa.String(120)))


def downgrade() -> None:
    op.drop_column("estimate_lines", "supplier")
