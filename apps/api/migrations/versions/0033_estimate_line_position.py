"""Order of the lines in an estimate, chosen in the editor.

Revision ID: 0033_estimate_line_position
Revises: 0032_portal_invitations
"""
from alembic import op
import sqlalchemy as sa

revision = "0033_estimate_line_position"
down_revision = "0032_portal_invitations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("estimate_lines", sa.Column("position", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("estimate_lines", "position")
