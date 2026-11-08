"""Public estimate links expire (existing links: 30 days after they were created).

Revision ID: 0029_estimate_link_expiry
Revises: 0028_contract_documents
"""
from alembic import op
import sqlalchemy as sa

revision = "0029_estimate_link_expiry"
down_revision = "0028_contract_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("estimate_approvals", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("estimate_approvals", "expires_at")
