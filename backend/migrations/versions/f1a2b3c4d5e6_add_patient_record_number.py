"""Add permanent, unique patient record numbers.

Revision ID: f1a2b3c4d5e6
Revises: d4c8a91f2e67
"""
from alembic import op
import sqlalchemy as sa
import re


revision = "f1a2b3c4d5e6"
down_revision = "d4c8a91f2e67"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)

    # MySQL commits DDL independently. On retry, keep objects already created
    # by a failed run instead of attempting to add them a second time.
    if "record_number" not in {column["name"] for column in inspector.get_columns("patients")}:
        op.add_column(
            "patients", sa.Column("record_number", sa.String(length=32), nullable=True)
        )
    if "patient_record_number_sequence" not in inspector.get_table_names():
        op.create_table(
            "patient_record_number_sequence",
            # The check below is incompatible with AUTO_INCREMENT in MySQL 8.0.46.
            sa.Column("id", sa.SmallInteger(), primary_key=True, autoincrement=False),
            sa.Column("current_value", sa.BigInteger(), nullable=False),
            sa.CheckConstraint("id = 1", name="ck_patient_record_number_sequence_singleton"),
        )
    if "patient_record_number_registry" not in sa.inspect(connection).get_table_names():
        op.create_table(
            "patient_record_number_registry",
            sa.Column("record_number", sa.String(length=32), primary_key=True),
            sa.Column("patient_id", sa.Integer(), nullable=True),
            sa.Column("is_consumed", sa.Boolean(), nullable=False),
        )

    # Do not overwrite assigned values on a retry. Fill only null patient
    # values, and reconcile each assigned value into the permanent registry.
    immutable_trigger = connection.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.TRIGGERS "
        "WHERE TRIGGER_SCHEMA = DATABASE() "
        "AND TRIGGER_NAME = 'trg_patients_record_number_immutable'"
    )).scalar_one() if connection.dialect.name == "mysql" else 0
    patient_rows = connection.execute(sa.text(
        "SELECT id, record_number FROM patients ORDER BY id"
    )).all()
    registry_rows = connection.execute(sa.text(
        "SELECT record_number, patient_id, is_consumed "
        "FROM patient_record_number_registry"
    )).all()
    registry = {number: (patient_id, bool(consumed)) for number, patient_id, consumed in registry_rows}
    assigned_by_patient = {}
    for patient_id, record_number in patient_rows:
        if record_number is not None:
            if record_number in assigned_by_patient and assigned_by_patient[record_number] != patient_id:
                raise RuntimeError(f"Número de prontuário duplicado: {record_number}.")
            assigned_by_patient[record_number] = patient_id
            current = registry.get(record_number)
            if current is not None and current[0] not in (None, patient_id):
                raise RuntimeError(
                    f"O registry associa {record_number} ao paciente {current[0]}, "
                    f"mas patients associa ao ID {patient_id}."
                )

    if immutable_trigger and any(number is None for _, number in patient_rows):
        raise RuntimeError(
            "Há pacientes sem número, mas o trigger de imutabilidade já existe. "
            "Interrompendo para revisão manual; nenhum número foi alterado."
        )

    for patient_id, current_number in patient_rows:
        number = current_number or f"PR-{patient_id:06d}"
        registry_owner = registry.get(number)
        if registry_owner is not None and registry_owner[0] not in (None, patient_id):
            raise RuntimeError(
                f"O número {number} já está associado ao paciente {registry_owner[0]}; "
                "migration interrompida sem sobrescrever a associação."
            )
        if current_number is None:
            other_patient = assigned_by_patient.get(number)
            if other_patient is not None and other_patient != patient_id:
                raise RuntimeError(
                    f"O número {number} já pertence ao paciente {other_patient}."
                )
            connection.execute(
                sa.text("UPDATE patients SET record_number = :number WHERE id = :id AND record_number IS NULL"),
                {"number": number, "id": patient_id},
            )
            assigned_by_patient[number] = patient_id
        if registry_owner is None:
            connection.execute(sa.text(
                "INSERT INTO patient_record_number_registry "
                "(record_number, patient_id, is_consumed) VALUES (:number, :id, TRUE)"
            ), {"number": number, "id": patient_id})
        elif registry_owner != (patient_id, True):
            connection.execute(sa.text(
                "UPDATE patient_record_number_registry "
                "SET patient_id = :id, is_consumed = TRUE WHERE record_number = :number"
            ), {"number": number, "id": patient_id})

    patient_ids = [patient_id for patient_id, _ in patient_rows]
    registry_numbers = [number for number, _, _ in registry_rows]
    registry_numbers.extend(number for _, number in patient_rows if number is not None)
    max_existing_number = max(
        (int(match.group(1)) for number in registry_numbers
         if (match := re.fullmatch(r"PR-(\d+)", number))),
        default=0,
    )
    high_water_mark = max([*patient_ids, max_existing_number], default=0)
    sequence_rows = connection.execute(sa.text(
        "SELECT id, current_value FROM patient_record_number_sequence ORDER BY id"
    )).all()
    if not sequence_rows:
        connection.execute(sa.text(
            "INSERT INTO patient_record_number_sequence (id, current_value) "
            "VALUES (1, :value)"
        ), {"value": high_water_mark})
    elif len(sequence_rows) != 1 or sequence_rows[0][0] != 1:
        raise RuntimeError("A sequência de prontuários não contém somente a linha id=1.")
    elif sequence_rows[0][1] < high_water_mark:
        # A retry may only advance the watermark; it never resets or lowers it.
        connection.execute(sa.text(
            "UPDATE patient_record_number_sequence SET current_value = :value "
            "WHERE id = 1 AND current_value < :value"
        ), {"value": high_water_mark})

    null_count = connection.execute(sa.text(
        "SELECT COUNT(*) FROM patients WHERE record_number IS NULL"
    )).scalar_one()
    if null_count:
        raise RuntimeError(f"Restam {null_count} pacientes sem número de prontuário.")

    columns = {column["name"]: column for column in sa.inspect(connection).get_columns("patients")}
    needs_not_null = columns["record_number"]["nullable"]
    unique_exists = any(
        constraint.get("column_names") == ["record_number"]
        for constraint in sa.inspect(connection).get_unique_constraints("patients")
    ) or any(
        index.get("unique") and index.get("column_names") == ["record_number"]
        for index in sa.inspect(connection).get_indexes("patients")
    )
    if connection.dialect.name == "sqlite":
        if needs_not_null or not unique_exists:
            with op.batch_alter_table("patients") as batch_op:
                if needs_not_null:
                    batch_op.alter_column(
                        "record_number", existing_type=sa.String(length=32),
                        existing_nullable=True, nullable=False,
                    )
                if not unique_exists:
                    batch_op.create_unique_constraint(
                        "uq_patients_record_number", ["record_number"]
                    )
    else:
        if needs_not_null:
            op.alter_column(
                "patients", "record_number", existing_type=sa.String(length=32),
                existing_nullable=True, nullable=False,
            )
        if not unique_exists:
            op.create_unique_constraint("uq_patients_record_number", "patients", ["record_number"])

    dialect = connection.dialect.name
    if dialect == "mysql":
        trigger_names = {row[0] for row in connection.execute(sa.text(
            "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS "
            "WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'patients'"
        ))}
    elif dialect == "sqlite":
        trigger_names = {row[0] for row in connection.execute(sa.text(
            "SELECT name FROM sqlite_master WHERE type = 'trigger'"
        ))}
    else:
        trigger_names = set()

    if dialect == "mysql":
        if "trg_patients_record_number_immutable" not in trigger_names:
            op.execute(sa.text("""
            CREATE TRIGGER trg_patients_record_number_immutable
            BEFORE UPDATE ON patients FOR EACH ROW
            BEGIN
              IF NOT (NEW.record_number <=> OLD.record_number) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'record_number is immutable';
              END IF;
            END
            """))
        if "trg_patients_record_number_reserved" not in trigger_names:
            op.execute(sa.text("""
            CREATE TRIGGER trg_patients_record_number_reserved
            BEFORE INSERT ON patients FOR EACH ROW
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM patient_record_number_registry
                WHERE record_number = NEW.record_number AND is_consumed = FALSE
              ) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'record_number is not reserved';
              END IF;
            END
            """))
        if "trg_patients_record_number_consume" not in trigger_names:
            op.execute(sa.text("""
            CREATE TRIGGER trg_patients_record_number_consume
            AFTER INSERT ON patients FOR EACH ROW
            BEGIN
              UPDATE patient_record_number_registry
              SET patient_id = NEW.id, is_consumed = TRUE
              WHERE record_number = NEW.record_number AND is_consumed = FALSE;
            END
            """))
    elif dialect == "sqlite":
        if "trg_patients_record_number_immutable" not in trigger_names:
            op.execute(sa.text("""
            CREATE TRIGGER trg_patients_record_number_immutable
            BEFORE UPDATE OF record_number ON patients
            WHEN NEW.record_number IS NOT OLD.record_number
            BEGIN
              SELECT RAISE(ABORT, 'record_number is immutable');
            END
            """))
        if "trg_patients_record_number_reserved" not in trigger_names:
            op.execute(sa.text("""
            CREATE TRIGGER trg_patients_record_number_reserved
            BEFORE INSERT ON patients
            WHEN NOT EXISTS (
              SELECT 1 FROM patient_record_number_registry
              WHERE record_number = NEW.record_number AND is_consumed = 0
            )
            BEGIN
              SELECT RAISE(ABORT, 'record_number is not reserved');
            END
            """))
        if "trg_patients_record_number_consume" not in trigger_names:
            op.execute(sa.text("""
            CREATE TRIGGER trg_patients_record_number_consume
            AFTER INSERT ON patients
            BEGIN
              UPDATE patient_record_number_registry
              SET patient_id = NEW.id, is_consumed = 1
              WHERE record_number = NEW.record_number AND is_consumed = 0;
            END
            """))


def downgrade():
    raise RuntimeError(
        "A migration de prontuários é irreversível: removê-la apagaria o histórico "
        "necessário para impedir a reutilização de números já atribuídos."
    )
