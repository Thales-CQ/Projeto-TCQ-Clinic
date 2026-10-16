"""Add nullable patient address fields.

Revision ID: f2a3b4c5d6e7
Revises: f1a2b3c4d5e6
"""
from alembic import op
import sqlalchemy as sa


revision = "f2a3b4c5d6e7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("patients")}
    address_columns = (
        ("postal_code", sa.String(length=8)),
        ("address", sa.String(length=255)),
        ("address_number", sa.String(length=20)),
        ("city", sa.String(length=120)),
        ("state", sa.String(length=2)),
    )
    # MySQL commits each ALTER independently. Skip columns completed by a
    # previous interrupted attempt so this revision can safely resume.
    for name, column_type in address_columns:
        if name not in columns:
            op.add_column("patients", sa.Column(name, column_type, nullable=True))
            columns.add(name)


def downgrade():
    raise RuntimeError(
        "A migration de endereço é irreversível após receber dados; remova os campos "
        "somente com um plano explícito de preservação dos endereços."
    )
