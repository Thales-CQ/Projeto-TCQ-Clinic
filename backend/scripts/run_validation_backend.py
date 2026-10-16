#!/usr/bin/env python3
"""Run the Flask API against clinica_validacao without loading backend/.env."""

from __future__ import annotations

import getpass
import os
import secrets
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL



ROOT = Path(__file__).resolve().parents[1]
DATABASE = "clinica_validacao"
CURRENT_USER = "clinica_teste@localhost"
EXPECTED_REVISION = "f3a4b5c6d7e8"
REQUIRED_COLUMNS = {
    "patients": {
        "id", "record_number", "full_name", "birth_date", "sex", "cpf", "phone",
        "email", "is_active", "created_at", "updated_at", "postal_code", "address",
        "address_number", "city", "state",
    },
    "users": {
        "id", "full_name", "birth_date", "email", "username", "password_hash",
        "is_active", "is_admin", "theme", "created_at",
    },
    "profiles": {"id", "name", "is_active", "created_at"},
    "permissions": {"id", "code", "description"},
    "user_profiles": {"user_id", "profile_id"},
    "profile_permissions": {"profile_id", "permission_id"},
    "cep_integrations": {
        "id", "provider_name", "url_template", "method", "field_map", "auth_header",
        "auth_prefix", "credential_ciphertext", "is_active", "updated_at",
    },
    "patient_record_number_sequence": {"id", "current_value"},
    "patient_record_number_registry": {"record_number", "patient_id", "is_consumed"},
    "alembic_version": {"version_num"},
}
REQUIRED_TRIGGERS = {
    "trg_patients_record_number_immutable",
    "trg_patients_record_number_reserved",
    "trg_patients_record_number_consume",
}


def validate_schema(connection):
    database, current_user, version = connection.execute(text(
        "SELECT DATABASE(), CURRENT_USER(), @@version"
    )).one()
    if (database, current_user) != (DATABASE, CURRENT_USER):
        raise RuntimeError(
            "Destino recusado: esperava clinica_validacao / clinica_teste@localhost."
        )
    if not version.startswith("8.0.46"):
        raise RuntimeError(f"Versão MySQL inesperada para validação: {version}")

    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    missing = []
    for table, required in REQUIRED_COLUMNS.items():
        if table not in tables:
            missing.append(f"tabela {table}")
            continue
        present = {column["name"] for column in inspector.get_columns(table)}
        missing.extend(f"coluna {table}.{name}" for name in sorted(required - present))
    if missing:
        raise RuntimeError("Schema ainda não está pronto: " + ", ".join(missing))

    collation_rows = connection.execute(text(
        "SELECT TABLE_NAME, COLLATION_NAME FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND ((TABLE_NAME = 'patients' AND COLUMN_NAME = 'record_number') "
        "OR (TABLE_NAME = 'patient_record_number_registry' "
        "AND COLUMN_NAME = 'record_number'))"
    )).all()
    collations = {table: collation for table, collation in collation_rows}
    from app.database_safety import assert_matching_record_number_collations

    assert_matching_record_number_collations(
        collations.get("patients"),
        collations.get("patient_record_number_registry"),
    )

    revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    if revision != EXPECTED_REVISION:
        raise RuntimeError(
            f"Revisão Alembic inesperada: {revision}; esperada {EXPECTED_REVISION}."
        )
    triggers = set(connection.execute(text(
        "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS "
        "WHERE TRIGGER_SCHEMA = DATABASE()"
    )).scalars())
    if not REQUIRED_TRIGGERS <= triggers:
        absent = ", ".join(sorted(REQUIRED_TRIGGERS - triggers))
        raise RuntimeError(f"Triggers de prontuário ausentes: {absent}")

    patients = connection.execute(text(
        "SELECT COUNT(*), COUNT(record_number), COUNT(DISTINCT record_number) FROM patients"
    )).one()
    if patients[0] != patients[1] or patients[0] != patients[2]:
        raise RuntimeError("Pacientes têm prontuários ausentes ou duplicados.")
    sequence = connection.execute(text(
        "SELECT id, current_value FROM patient_record_number_sequence ORDER BY id"
    )).all()
    if len(sequence) != 1 or sequence[0][0] != 1:
        raise RuntimeError("A sequência de prontuários não tem singleton id=1.")
    max_number = connection.execute(text(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(record_number, 4) AS UNSIGNED)), 0) "
        "FROM patients WHERE record_number REGEXP '^PR-[0-9]+$'"
    )).scalar_one()
    if sequence[0][1] < max_number:
        raise RuntimeError("Watermark está abaixo do maior prontuário atribuído.")
    mismatch_count = connection.execute(text(
        "SELECT COUNT(*) FROM patients p "
        "LEFT JOIN patient_record_number_registry r "
        "ON BINARY r.record_number = BINARY p.record_number "
        "AND r.patient_id = p.id AND r.is_consumed = 1 "
        "WHERE r.record_number IS NULL"
    )).scalar_one()
    if mismatch_count:
        raise RuntimeError(
            f"Registry não corresponde a {mismatch_count} paciente(s)."
        )
    user_count = connection.execute(text("SELECT COUNT(*) FROM users")).scalar_one()
    if user_count != 4:
        raise RuntimeError(f"Esperados quatro usuários de acesso; encontrados {user_count}.")
    print(
        f"Destino confirmado: {database} / {current_user}; MySQL {version}; "
        f"Alembic {revision}; pacientes {patients[0]}; usuários {user_count}."
    )


def main():
    password = getpass.getpass("Senha de clinica_teste (entrada apenas em memória): ")
    url = URL.create(
        "mysql+pymysql",
        username="clinica_teste",
        password=password,
        host="127.0.0.1",
        port=3306,
        database=DATABASE,
    )

    # These values are set before importing app.config; validation mode then
    # skips dotenv entirely and uses a process-local session signing key.
    os.environ["TCQ_VALIDATION_MODE"] = "1"
    os.environ["TCQ_VALIDATION_EXPECTED_DATABASE"] = DATABASE
    os.environ["TCQ_VALIDATION_EXPECTED_USER"] = CURRENT_USER
    os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)
    os.environ["SECRET_KEY"] = secrets.token_urlsafe(48)
    os.environ["SESSION_COOKIE_SECURE"] = "false"
    os.environ["CEP_PROVIDER_ALLOWED_HOSTS"] = "viacep.com.br"
    os.environ["CEP_CREDENTIAL_ENCRYPTION_KEYS"] = ""
    sys.path.insert(0, str(ROOT))

    engine = create_engine(url, hide_parameters=True, echo=False, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            validate_schema(connection)
    except Exception as exc:
        print(f"Backend de validação não iniciado: {exc}", file=sys.stderr)
        return 2
    finally:
        engine.dispose()

    from app import create_app

    app = create_app()
    port = int(os.getenv("TCQ_VALIDATION_PORT", "5000"))
    print(f"Flask escutando somente em http://127.0.0.1:{port}; guard de banco ativo.")
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
