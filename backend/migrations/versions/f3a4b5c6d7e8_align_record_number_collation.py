"""Align permanent record-number registry with patients column collation.

Revision ID: f3a4b5c6d7e8
Revises: f2a3b4c5d6e7
"""
import re

from alembic import op
import sqlalchemy as sa


revision = "f3a4b5c6d7e8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def _column_character_set_and_collation(connection, table_name):
    row = connection.execute(sa.text(
        "SELECT CHARACTER_SET_NAME, COLLATION_NAME, CHARACTER_MAXIMUM_LENGTH, "
        "IS_NULLABLE FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name "
        "AND COLUMN_NAME = 'record_number'"
    ), {"table_name": table_name}).one_or_none()
    if row is None:
        raise RuntimeError(f"Coluna {table_name}.record_number não encontrada.")
    charset, collation, length, nullable = row
    if length != 32 or nullable != "NO" or not charset or not collation:
        raise RuntimeError(
            f"Formato inesperado para {table_name}.record_number; "
            "esperado VARCHAR(32) NOT NULL com charset/collation definidos."
        )
    if not re.fullmatch(r"[A-Za-z0-9_]+", charset) or not re.fullmatch(
        r"[A-Za-z0-9_]+", collation
    ):
        raise RuntimeError("Charset ou collation MySQL contém identificador inesperado.")
    return charset, collation


def upgrade():
    connection = op.get_bind()
    if connection.dialect.name != "mysql":
        # SQLite has no MySQL collation metadata; the schema has no mixed-collation
        # comparison there, and the migration remains portable for unit tests.
        return

    patient_charset, patient_collation = _column_character_set_and_collation(
        connection, "patients"
    )
    registry_charset, registry_collation = _column_character_set_and_collation(
        connection, "patient_record_number_registry"
    )
    if (patient_charset, patient_collation) == (registry_charset, registry_collation):
        return

    # The registry column is a primary key. MODIFY preserves its key while
    # explicitly matching the comparison semantics of patients.record_number.
    op.execute(sa.text(
        "ALTER TABLE `patient_record_number_registry` "
        "MODIFY `record_number` VARCHAR(32) "
        f"CHARACTER SET {patient_charset} COLLATE {patient_collation} NOT NULL"
    ))


def downgrade():
    raise RuntimeError(
        "A collation reversal would reintroduce the MySQL trigger comparison failure."
    )
