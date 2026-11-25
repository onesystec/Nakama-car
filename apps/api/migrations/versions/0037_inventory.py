"""Magazzino: inventory articles and stock movements, by Meccanica / Carrozzeria.

Revision ID: 0037_inventory
Revises: 0036_technical_sheets
"""
from alembic import op
import sqlalchemy as sa

revision = "0037_inventory"
down_revision = "0036_technical_sheets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("area", sa.String(12), nullable=False),
        sa.Column("category", sa.String(20), nullable=False, server_default="RICAMBIO"),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(80)),
        sa.Column("brand", sa.String(80)),
        sa.Column("unit", sa.String(8), nullable=False, server_default="PZ"),
        sa.Column("quantity", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("min_quantity", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("location", sa.String(80)),
        sa.Column("supplier", sa.String(160)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_inventory_items_tenant_id", "inventory_items", ["tenant_id"])
    op.create_index("ix_inventory_items_area", "inventory_items", ["area"])
    op.create_table(
        "inventory_movements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 2), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 2)),
        sa.Column("movement_date", sa.Date(), nullable=False),
        sa.Column("repair_case_id", sa.Uuid(), sa.ForeignKey("repair_cases.id", ondelete="SET NULL")),
        sa.Column("case_number", sa.String(40)),
        sa.Column("plate", sa.String(20)),
        sa.Column("supplier", sa.String(160)),
        sa.Column("note", sa.String(255)),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_inventory_movements_tenant_id", "inventory_movements", ["tenant_id"])
    op.create_index("ix_inventory_movements_item_id", "inventory_movements", ["item_id"])
    op.create_index("ix_inventory_movements_movement_date", "inventory_movements", ["movement_date"])
    op.create_index("ix_inventory_movements_repair_case_id", "inventory_movements", ["repair_case_id"])


def downgrade() -> None:
    for name in ("repair_case_id", "movement_date", "item_id", "tenant_id"):
        op.drop_index(f"ix_inventory_movements_{name}", table_name="inventory_movements")
    op.drop_table("inventory_movements")
    op.drop_index("ix_inventory_items_area", table_name="inventory_items")
    op.drop_index("ix_inventory_items_tenant_id", table_name="inventory_items")
    op.drop_table("inventory_items")
