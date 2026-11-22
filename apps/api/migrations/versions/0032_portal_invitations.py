"""Store hashed portal invitations and internal suspension reasons."""
from alembic import op
import sqlalchemy as sa

revision = "0032_portal_invitations"
down_revision = "0031_portal_service_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("portal_accounts", sa.Column("invitation_digest", sa.String(64)))
    op.add_column("portal_accounts", sa.Column("invitation_expires_at", sa.DateTime(timezone=True)))
    op.add_column("portal_accounts", sa.Column("suspension_reason", sa.String(240)))
    op.create_unique_constraint("uq_portal_accounts_invitation_digest", "portal_accounts", ["invitation_digest"])


def downgrade() -> None:
    op.drop_constraint("uq_portal_accounts_invitation_digest", "portal_accounts", type_="unique")
    op.drop_column("portal_accounts", "suspension_reason")
    op.drop_column("portal_accounts", "invitation_expires_at")
    op.drop_column("portal_accounts", "invitation_digest")
