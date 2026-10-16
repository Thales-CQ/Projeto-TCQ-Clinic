#!/usr/bin/env python3
"""Supervised Alembic runner for the isolated MySQL validation database.

No password is accepted on the command line or written to disk. Without
--apply this performs read-only identity, grant, and baseline checks only.
"""

import argparse
import getpass
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_DATABASE = "clinica_validacao"
EXPECTED_USER = "clinica_teste@localhost"
MINIMUM_COUNTS = {"patients": 39}
EXPECTED_COUNTS = {"users": 4}
NEW_COLUMNS = {
    "patients": {
        "record_number", "postal_code", "address", "address_number", "city", "state",
        "sex",
    },
    "users": {"full_name", "birth_date", "email", "is_admin", "theme"},
}
EXPECTED_HEAD = "f3a4b5c6d7e8"
REQUIRED_PATIENT_TRIGGERS = {
    "trg_patients_record_number_immutable",
    "trg_patients_record_number_reserved",
    "trg_patients_record_number_consume",
}


def assert_target(connection):
    database, current_user = connection.execute(
        text("SELECT DATABASE(), CURRENT_USER()")
    ).one()
    if (database, current_user) != (EXPECTED_DATABASE, EXPECTED_USER):
        raise RuntimeError(
            "Destino recusado: DATABASE()/CURRENT_USER() não correspondem "
            "ao banco isolado autorizado."
        )
    return database, current_user


def trigger_creation_preflight(connection):
    log_bin, trust_creators = connection.execute(text(
        "SELECT @@GLOBAL.log_bin, @@GLOBAL.log_bin_trust_function_creators"
    )).one()
    existing = set(connection.execute(text(
        "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS "
        "WHERE TRIGGER_SCHEMA = DATABASE()"
    )).scalars())
    missing = REQUIRED_PATIENT_TRIGGERS - existing
    return bool(log_bin), bool(trust_creators), missing


def trigger_preflight_blocked(log_bin, trust_creators, missing_triggers):
    return bool(log_bin and not trust_creators and missing_triggers)


def capture_rows(connection, table):
    columns = [column["name"] for column in inspect(connection).get_columns(table)]
    if "id" not in columns:
        raise RuntimeError(f"Tabela {table} não possui coluna id.")
    quoted = ", ".join(f"`{name}`" for name in columns)
    rows = connection.execute(
        text(f"SELECT {quoted} FROM `{table}` ORDER BY `id`")
    ).mappings().all()
    return columns, {row["id"]: dict(row) for row in rows}


def capture_baseline(connection):
    baseline = {}
    expected_tables = set(EXPECTED_COUNTS) | set(MINIMUM_COUNTS)
    for table in sorted(expected_tables):
        columns, rows = capture_rows(connection, table)
        exact_count = EXPECTED_COUNTS.get(table)
        minimum_count = MINIMUM_COUNTS.get(table)
        if exact_count is not None and len(rows) != exact_count:
            raise RuntimeError(
                f"Baseline recusado: {table} tem {len(rows)} registros; "
                f"esperados {exact_count}."
            )
        if minimum_count is not None and len(rows) < minimum_count:
            raise RuntimeError(
                f"Baseline recusado: {table} tem {len(rows)} registros; "
                f"mínimo esperado {minimum_count}."
            )
        baseline[table] = (columns, rows)
    return baseline


def capture_associations(connection):
    user_profiles = tuple(connection.execute(text(
        "SELECT user_id, profile_id FROM user_profiles ORDER BY user_id, profile_id"
    )).all())
    profile_permissions = tuple(connection.execute(text(
        "SELECT profile_id, permission_id FROM profile_permissions "
        "ORDER BY profile_id, permission_id"
    )).all())
    return user_profiles, profile_permissions


def compare_baseline(connection, baseline):
    for table, (old_columns, old_rows) in baseline.items():
        new_columns, new_rows = capture_rows(connection, table)
        added = set(new_columns) - set(old_columns)
        if not added.issubset(NEW_COLUMNS.get(table, set())):
            raise RuntimeError(f"Colunas inesperadas adicionadas em {table}: {sorted(added)}")
        if set(old_rows) != set(new_rows):
            raise RuntimeError(f"IDs originais de {table} foram alterados.")
        for record_id, old_row in old_rows.items():
            changed = [
                name for name in old_columns
                if old_row[name] != new_rows[record_id].get(name)
                and not (
                    table == "patients"
                    and name == "record_number"
                    and old_row[name] is None
                    and new_rows[record_id].get(name) == f"PR-{record_id:06d}"
                )
            ]
            if changed:
                raise RuntimeError(
                    f"Dados originais alterados em {table}.id={record_id}: {changed}"
                )


def verify_record_number_collations(connection):
    rows = connection.execute(text(
        "SELECT TABLE_NAME, COLLATION_NAME FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() "
        "AND ((TABLE_NAME = 'patients' AND COLUMN_NAME = 'record_number') "
        "OR (TABLE_NAME = 'patient_record_number_registry' "
        "AND COLUMN_NAME = 'record_number'))"
    )).all()
    collations = {table: collation for table, collation in rows}
    from app.database_safety import assert_matching_record_number_collations

    assert_matching_record_number_collations(
        collations.get("patients"),
        collations.get("patient_record_number_registry"),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true",
        help="executa Alembic até head após confirmar o destino e a aprovação interativa",
    )
    parser.add_argument(
        "--show-grants", action="store_true",
        help="exibe SHOW GRANTS da conta validada (leitura apenas)",
    )
    args = parser.parse_args()

    password = getpass.getpass("Senha de clinica_teste@127.0.0.1: ")
    url = URL.create(
        "mysql+pymysql", username="clinica_teste", password=password,
        host="127.0.0.1", database=EXPECTED_DATABASE,
    )
    os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)

    # Import only after DATABASE_URL is supplied in this process.
    sys.path.insert(0, str(ROOT))
    from app import create_app

    engine = create_engine(url, hide_parameters=True, echo=False)
    try:
        with engine.connect() as connection:
            database, current_user = assert_target(connection)
            if args.show_grants:
                grants = connection.execute(text("SHOW GRANTS FOR CURRENT_USER()"))
                for row in grants:
                    print(row[0])

            log_bin, trust_creators, missing_triggers = trigger_creation_preflight(connection)
            print(
                "Pré-verificação de triggers: "
                f"log_bin={int(log_bin)}, "
                f"log_bin_trust_function_creators={int(trust_creators)}, "
                f"triggers ausentes={len(missing_triggers)}."
            )
            if args.apply and trigger_preflight_blocked(
                log_bin, trust_creators, missing_triggers
            ):
                print(
                    "Execução recusada antes de qualquer DDL: MySQL 1419 é esperado "
                    "porque faltam triggers e binary logging está ativo. Um DBA deve "
                    "habilitar temporariamente log_bin_trust_function_creators=1, "
                    "acompanhar a execução e restaurar o valor original; o runner não "
                    "altera variáveis globais nem concede privilégios.",
                    file=sys.stderr,
                )
                return 3

            baseline = capture_baseline(connection)
            association_baseline = capture_associations(connection)
            print(
                f"Conexão confirmada: {database}; {current_user}. "
                "Baseline em memória: "
                f"{len(baseline['patients'][1])} pacientes e "
                f"{len(baseline['users'][1])} usuários."
            )
            if not args.apply:
                print("Somente leitura: migrations não foram executadas.")
                return 0

            app = create_app()
            from alembic import command
            from alembic.config import Config

            alembic_config = Config(str(ROOT / "migrations" / "alembic.ini"))
            alembic_config.set_main_option(
                "script_location", str(ROOT / "migrations")
            )
            alembic_config.attributes["connection"] = connection
            alembic_config.attributes["expected_database"] = EXPECTED_DATABASE
            alembic_config.attributes["expected_current_user"] = EXPECTED_USER

            approval = input(
                "Para autorizar agora Alembic upgrade head em "
                "clinica_validacao, digite MIGRAR clinica_validacao: "
            )
            if approval != "MIGRAR clinica_validacao":
                print("Cancelado; nenhuma migration executada.")
                return 2
            # Baseline SELECTs above cause SQLAlchemy 2.x to autobegin a
            # transaction. MySQL DDL implicitly commits, but Alembic's final
            # version-table update can otherwise remain in the connection's
            # transaction and be rolled back when this connection closes.
            connection.commit()
            with app.app_context():
                command.upgrade(alembic_config, "head")
            connection.commit()

            assert_target(connection)
            verify_record_number_collations(connection)
            compare_baseline(connection, baseline)
            if capture_associations(connection) != association_baseline:
                raise RuntimeError("Associações de usuários/perfis/permissões foram alteradas.")
            revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            if revision != EXPECTED_HEAD:
                raise RuntimeError(f"Revisão final inesperada: {revision}")

            columns = {
                column["name"] for column in inspect(connection).get_columns("patients")
            }
            if not NEW_COLUMNS["patients"].issubset(columns):
                raise RuntimeError("Colunas esperadas de prontuário/endereço ausentes.")
            number_stats = connection.execute(text("""
                SELECT COUNT(*), COUNT(DISTINCT record_number), COUNT(record_number)
                FROM patients
            """)).one()
            expected_patient_count = len(baseline["patients"][1])
            if number_stats != (
                expected_patient_count,
                expected_patient_count,
                expected_patient_count,
            ):
                raise RuntimeError("Números de prontuário ausentes ou duplicados.")
            registry_mismatch_count = connection.execute(text(
                "SELECT COUNT(*) FROM patients p "
                "LEFT JOIN patient_record_number_registry r "
                "ON BINARY r.record_number = BINARY p.record_number "
                "AND r.patient_id = p.id AND r.is_consumed = 1 "
                "WHERE r.record_number IS NULL"
            )).scalar_one()
            if registry_mismatch_count:
                raise RuntimeError(
                    f"Registry não corresponde a {registry_mismatch_count} paciente(s)."
                )
            # Confirm durability from a separate session, not just the session
            # that executed Alembic. This catches an uncommitted revision row.
            with engine.connect() as verification_connection:
                assert_target(verification_connection)
                durable_revision = verification_connection.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar_one()
                if durable_revision != EXPECTED_HEAD:
                    raise RuntimeError(
                        "Revisão não persistida após reconectar: "
                        f"{durable_revision}; esperada {EXPECTED_HEAD}."
                    )
            print(
                "Pós-verificação aprovada: IDs e valores originais preservados; "
                f"{expected_patient_count} prontuários únicos; "
                "migrations de endereço presentes."
            )
            return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
