"""Add configurable CEP integration and isolated permissions.

Revision ID: d4c8a91f2e67
Revises: 2c8e91b4a6d0
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "d4c8a91f2e67"
down_revision = "2c8e91b4a6d0"
branch_labels = None
depends_on = None


PERMISSIONS = (
    ("integrations.cep.view", "Consultar configuração da integração de CEP"),
    ("integrations.cep.configure", "Configurar provedor de CEP"),
    ("integrations.cep.manage", "Gerenciar credencial do provedor de CEP"),
    ("integrations.cep.lookup", "Consultar CEP"),
)
VIA_CEP = {
    "provider_name": "ViaCEP",
    "url_template": "https://viacep.com.br/ws/{cep}/json/",
    "method": "GET",
    "field_map": {
        "cep": "cep", "address": "logradouro",
        "city": "localidade", "state": "uf",
    },
}


def upgrade():
    op.create_table(
        "cep_integrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_name", sa.String(length=120), nullable=False),
        sa.Column("url_template", sa.String(length=500), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("field_map", sa.JSON(), nullable=False),
        sa.Column("auth_header", sa.String(length=120), nullable=True),
        sa.Column("auth_prefix", sa.String(length=40), nullable=True),
        sa.Column("credential_ciphertext", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.bulk_insert(
        sa.table(
            "cep_integrations",
            sa.column("provider_name", sa.String()),
            sa.column("url_template", sa.String()),
            sa.column("method", sa.String()),
            sa.column("field_map", sa.JSON()),
            sa.column("is_active", sa.Boolean()),
            sa.column("updated_at", sa.DateTime(timezone=True)),
        ),
        [{**VIA_CEP, "is_active": True,
          "updated_at": datetime.now(timezone.utc)}],
    )

    connection = op.get_bind()
    admin_id = connection.execute(sa.text(
        "SELECT id FROM profiles WHERE name = :name"
    ), {"name": "Administrador"}).scalar_one()
    for code, description in PERMISSIONS:
        permission_id = connection.execute(sa.text(
            "SELECT id FROM permissions WHERE code = :code"
        ), {"code": code}).scalar_one_or_none()
        if permission_id is None:
            permission_id = connection.execute(sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description)"
            ), {"code": code, "description": description}).lastrowid
        linked = connection.execute(sa.text(
            "SELECT 1 FROM profile_permissions "
            "WHERE profile_id = :profile_id AND permission_id = :permission_id"
        ), {"profile_id": admin_id, "permission_id": permission_id}).scalar_one_or_none()
        if linked is None:
            connection.execute(sa.text(
                "INSERT INTO profile_permissions (profile_id, permission_id) "
                "VALUES (:profile_id, :permission_id)"
            ), {"profile_id": admin_id, "permission_id": permission_id})


def downgrade():
    connection = op.get_bind()
    ids = [row[0] for row in connection.execute(sa.text(
        "SELECT id FROM permissions WHERE code IN "
        "('integrations.cep.view', 'integrations.cep.configure', "
        "'integrations.cep.manage', 'integrations.cep.lookup')"
    )).all()]
    if ids:
        connection.execute(sa.text(
            "DELETE FROM profile_permissions WHERE permission_id IN :ids"
        ).bindparams(sa.bindparam("ids", expanding=True)), {"ids": ids})
        connection.execute(sa.text(
            "DELETE FROM permissions WHERE id IN :ids"
        ).bindparams(sa.bindparam("ids", expanding=True)), {"ids": ids})
    op.drop_table("cep_integrations")
