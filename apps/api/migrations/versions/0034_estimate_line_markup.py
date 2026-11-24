"""Workshop markup on the cost of a part, per estimate line (internal).

Revision ID: 0034_estimate_line_markup
Revises: 0033_estimate_line_position
"""
from alembic import op
import sqlalchemy as sa

revision = "0034_estimate_line_markup"
down_revision = "0033_estimate_line_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("estimate_lines", sa.Column("markup_percent", sa.Numeric(6, 2), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("estimate_lines", "markup_percent")
