"""When and by whom each vehicle was handed back to the customer.

Kept on the repair case, so the delivery stays visible after the invoice (which moves the case to
INVOICED). Existing deliveries are recovered from the audit log of the work orders.

Revision ID: 0039_case_delivery
Revises: 0038_case_mechanic
"""
from alembic import op
import sqlalchemy as sa

revision = "0039_case_delivery"
down_revision = "0038_case_mechanic"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("repair_cases", sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("repair_cases", sa.Column("delivered_by", sa.Uuid(), nullable=True))
    op.create_index("ix_repair_cases_delivered_at", "repair_cases", ["delivered_at"])
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT w.repair_case_id, a.created_at, a.user_id, a.new_value FROM audit_logs a "
        "JOIN work_orders w ON w.id = a.entity_id AND w.tenant_id = a.tenant_id "
        "WHERE a.entity_type = 'work_order' AND a.action = 'status_changed' ORDER BY a.created_at"
    )).all()
    # The JSON value is compared in Python, so the same query works on PostgreSQL and SQLite.
    first: dict = {}
    for case_id, created_at, user_id, value in rows:
        if str(value).strip('"') == "DELIVERED" and case_id not in first:
            first[case_id] = (created_at, user_id)
    for case_id, (created_at, user_id) in first.items():
        bind.execute(
            sa.text("UPDATE repair_cases SET delivered_at = :at, delivered_by = :by "
                    "WHERE id = :id AND status IN ('DELIVERED', 'INVOICED')"),
            {"at": created_at, "by": user_id, "id": case_id},
        )


def downgrade() -> None:
    op.drop_index("ix_repair_cases_delivered_at", table_name="repair_cases")
    op.drop_column("repair_cases", "delivered_by")
    op.drop_column("repair_cases", "delivered_at")
