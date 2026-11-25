"""Staff personal data (birth place, IBAN) and personal documents.

Revision ID: 0037_staff_documents
Revises: 0036_technical_sheets
"""
from alembic import op
import sqlalchemy as sa

revision = "0037_staff_documents"
down_revision = "0036_technical_sheets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_profiles", sa.Column("birth_place", sa.String(120)))
    op.add_column("user_profiles", sa.Column("iban", sa.String(34)))
    op.create_table(
        "staff_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="OTHER"),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("uploaded_by", sa.Uuid(), nullable=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_documents_tenant_id", "staff_documents", ["tenant_id"])
    op.create_index("ix_staff_documents_user_id", "staff_documents", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_staff_documents_user_id", table_name="staff_documents")
    op.drop_index("ix_staff_documents_tenant_id", table_name="staff_documents")
    op.drop_table("staff_documents")
    op.drop_column("user_profiles", "iban")
    op.drop_column("user_profiles", "birth_place")
