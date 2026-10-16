"""Fail-closed database identity checks for the validation runtime."""

from sqlalchemy import event


class DatabaseTargetMismatch(RuntimeError):
    """Raised when a validation connection is not the approved database/user."""


def assert_database_identity(
    database,
    current_user,
    *,
    expected_database="clinica_validacao",
    expected_user="clinica_teste@localhost",
):
    if database != expected_database or current_user != expected_user:
        raise DatabaseTargetMismatch(
            "Operação bloqueada: DATABASE()/CURRENT_USER() não correspondem "
            "ao destino de validação autorizado."
        )


def assert_matching_record_number_collations(patient_collation, registry_collation):
    """Require trigger-compared prontuário columns to use one MySQL collation."""
    if (
        not patient_collation
        or not registry_collation
        or patient_collation != registry_collation
    ):
        raise RuntimeError(
            "Collations incompatíveis ou ausentes em patients.record_number e "
            "patient_record_number_registry.record_number."
        )


def install_validation_database_guard(
    engine,
    *,
    expected_database="clinica_validacao",
    expected_user="clinica_teste@localhost",
):
    """Check identity immediately before every SQL statement on this engine."""

    def verify_target(connection, cursor, statement, parameters, context, executemany):
        raw_connection = connection.connection.driver_connection
        identity_cursor = raw_connection.cursor()
        try:
            identity_cursor.execute("SELECT DATABASE(), CURRENT_USER()")
            database, current_user = identity_cursor.fetchone()
        finally:
            identity_cursor.close()

        assert_database_identity(
            database,
            current_user,
            expected_database=expected_database,
            expected_user=expected_user,
        )

    event.listen(engine, "before_cursor_execute", verify_target)
    return verify_target
