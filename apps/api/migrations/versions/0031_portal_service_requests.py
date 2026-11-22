"""Store vehicle service and ONE TRACK requests from the customer portal."""
from alembic import op
import sqlalchemy as sa

revision = "0031_portal_service_requests"
down_revision = "0030_user_temporary_password"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_service_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_id", sa.Uuid(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False),
        sa.Column("handled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_portal_service_requests_tenant_id", "portal_service_requests", ["tenant_id"])
    op.create_index("ix_portal_service_requests_customer_scope", "portal_service_requests", ["tenant_id", "customer_id"])


def downgrade() -> None:
    op.drop_table("portal_service_requests")
