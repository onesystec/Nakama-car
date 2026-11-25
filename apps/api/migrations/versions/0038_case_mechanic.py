"""Workshop worker who opened each repair case, kept to the end of the job.

Existing cases get the author of their first diagnosis, or else whoever ticked the first job.

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
    op.execute("""
        UPDATE repair_cases SET mechanic_id = (
            SELECT d.created_by FROM diagnoses d
            WHERE d.repair_case_id = repair_cases.id ORDER BY d.created_at LIMIT 1
        ), mechanic_assigned_at = (
            SELECT d.created_at FROM diagnoses d
            WHERE d.repair_case_id = repair_cases.id ORDER BY d.created_at LIMIT 1
        )
        WHERE mechanic_id IS NULL
    """)
    op.execute("""
        UPDATE repair_cases SET mechanic_id = (
            SELECT t.completed_by FROM work_order_tasks t JOIN work_orders w ON w.id = t.work_order_id
            WHERE w.repair_case_id = repair_cases.id AND t.completed_by IS NOT NULL ORDER BY t.completed_at LIMIT 1
        ), mechanic_assigned_at = (
            SELECT t.completed_at FROM work_order_tasks t JOIN work_orders w ON w.id = t.work_order_id
            WHERE w.repair_case_id = repair_cases.id AND t.completed_by IS NOT NULL ORDER BY t.completed_at LIMIT 1
        )
        WHERE mechanic_id IS NULL
    """)


def downgrade() -> None:
    op.drop_index("ix_repair_cases_mechanic_id", table_name="repair_cases")
    op.drop_column("repair_cases", "mechanic_assigned_at")
    op.drop_column("repair_cases", "mechanic_id")
