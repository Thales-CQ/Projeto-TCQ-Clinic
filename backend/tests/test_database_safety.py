import pytest
from sqlalchemy import create_engine, text

import app.database_safety as database_safety
from app.database_safety import (
    DatabaseTargetMismatch,
    assert_database_identity,
    assert_matching_record_number_collations,
)
from scripts.run_validated_mysql_migrations import capture_baseline, trigger_preflight_blocked


@pytest.mark.parametrize(
    ("database", "current_user"),
    [("clinica_validacao", "clinica_teste@localhost")],
)
def test_validation_identity_accepts_only_expected_database_account(database, current_user):
    assert_database_identity(database, current_user)


@pytest.mark.parametrize(
    ("database", "current_user"),
    [
        ("clinica", "clinica_teste@localhost"),
        ("clinica_validacao", "root@localhost"),
        (None, "clinica_teste@localhost"),
    ],
)
def test_validation_identity_rejects_other_targets(database, current_user):
    with pytest.raises(DatabaseTargetMismatch):
        assert_database_identity(database, current_user)


def test_record_number_collation_guard_accepts_matching_collations():
    assert_matching_record_number_collations(
        "utf8mb4_0900_ai_ci", "utf8mb4_0900_ai_ci"
    )


@pytest.mark.parametrize(
    ("patient_collation", "registry_collation"),
    [
        ("utf8mb4_0900_ai_ci", "utf8mb4_unicode_ci"),
        ("utf8mb4_0900_ai_ci", None),
        (None, "utf8mb4_0900_ai_ci"),
    ],
)
def test_record_number_collation_guard_rejects_missing_or_mismatched_collations(
    patient_collation, registry_collation
):
    with pytest.raises(RuntimeError, match="Collations incompatíveis"):
        assert_matching_record_number_collations(patient_collation, registry_collation)


def test_engine_guard_checks_identity_before_the_statement(monkeypatch):
    registered = {}

    class Cursor:
        def __init__(self, identity):
            self.identity = identity
            self.statement = None

        def execute(self, statement):
            self.statement = statement

        def fetchone(self):
            return self.identity

        def close(self):
            pass

    class DriverConnection:
        def __init__(self, identity):
            self.identity = identity

        def cursor(self):
            cursor = Cursor(self.identity)
            registered["cursor"] = cursor
            return cursor

    class ConnectionProxy:
        def __init__(self, identity):
            self.connection = type(
                "PoolConnection", (), {"driver_connection": DriverConnection(identity)}
            )()

    def capture_listener(engine, event_name, callback):
        registered.update(engine=engine, event_name=event_name, callback=callback)

    monkeypatch.setattr(database_safety.event, "listen", capture_listener)
    engine = object()
    database_safety.install_validation_database_guard(engine)

    assert registered["engine"] is engine
    assert registered["event_name"] == "before_cursor_execute"
    registered["callback"](
        ConnectionProxy(("clinica_validacao", "clinica_teste@localhost")),
        object(), "INSERT INTO patients ...", {}, None, False,
    )
    assert registered["cursor"].statement == "SELECT DATABASE(), CURRENT_USER()"

    with pytest.raises(DatabaseTargetMismatch):
        registered["callback"](
            ConnectionProxy(("clinica", "clinica_teste@localhost")),
            object(), "INSERT INTO patients ...", {}, None, False,
        )


@pytest.mark.parametrize(
    ("log_bin", "trust_creators", "missing", "blocked"),
    [
        (1, 0, {"trg_patients_record_number_immutable"}, True),
        (1, 1, {"trg_patients_record_number_immutable"}, False),
        (0, 0, {"trg_patients_record_number_immutable"}, False),
        (1, 0, set(), False),
    ],
)
def test_migration_runner_blocks_before_1419_when_triggers_are_missing(
    log_bin, trust_creators, missing, blocked
):
    assert trigger_preflight_blocked(log_bin, trust_creators, missing) is blocked


def test_migration_baseline_preserves_validation_patients_beyond_original_seed():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE patients (id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            connection.execute(text(
                "INSERT INTO patients (id) VALUES "
                + ",".join(f"({patient_id})" for patient_id in range(1, 41))
            ))
            connection.execute(text(
                "INSERT INTO users (id) VALUES (1), (2), (3), (4)"
            ))

            baseline = capture_baseline(connection)

        assert len(baseline["patients"][1]) == 40
        assert len(baseline["users"][1]) == 4
    finally:
        engine.dispose()
