"""Workers given a temporary password must choose their own at the first login.

Revision ID: 0030_user_temporary_password
Revises: 0029_estimate_link_expiry
"""
from alembic import op
import sqlalchemy as sa

revision = "0030_user_temporary_password"
down_revision = "0029_estimate_link_expiry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
