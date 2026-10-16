from datetime import date, datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from flask_migrate import upgrade
from sqlalchemy.exc import IntegrityError
from sqlalchemy import CheckConstraint, Column, MetaData, SmallInteger, Table, inspect, text
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable

from app import create_app
from app.config import Config
from app.extensions import db
from app.models import Patient, PatientRecordNumberSequence


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setattr(
        Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'patients.db'}"
    )
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        upgrade()
        try:
            yield app
        finally:
            db.session.remove()
            db.engine.dispose()


def test_create_patient_with_defaults(app):
    patient = Patient(
        full_name="Maria Silva",
        birth_date=date(1990, 5, 20),
        sex="F",
    )
    db.session.add(patient)
    db.session.commit()
    patient_id = patient.id
    db.session.expunge_all()

    saved = db.session.get(Patient, patient_id)
    assert saved.full_name == "Maria Silva"
    assert saved.is_active is True
    assert saved.cpf is None
    assert isinstance(saved.created_at, datetime)
    assert isinstance(saved.updated_at, datetime)


def test_persist_main_fields(app):
    patient = Patient(
        full_name="Ana Souza",
        birth_date=date(1990, 5, 20),
        sex="F",
        cpf="52998224725",
        phone="11987654321",
        email="ana@example.com",
        is_active=False,
    )
    db.session.add(patient)
    db.session.commit()
    patient_id = patient.id
    db.session.expunge_all()

    saved = db.session.get(Patient, patient_id)
    assert saved.full_name == "Ana Souza"
    assert saved.birth_date == date(1990, 5, 20)
    assert saved.cpf == "52998224725"
    assert saved.phone == "11987654321"
    assert saved.email == "ana@example.com"
    assert saved.is_active is False


def test_multiple_patients_without_cpf(app):
    db.session.add_all([
        Patient(full_name="Ana", birth_date=date(1990, 5, 20), sex="F"),
        Patient(full_name="Maria", birth_date=date(1992, 8, 15), sex="F"),
    ])
    db.session.commit()

    assert Patient.query.filter_by(cpf=None).count() == 2


def test_duplicate_cpf_is_rejected(app):
    db.session.add_all([
        Patient(full_name="Ana", cpf="52998224725"),
        Patient(full_name="Maria", cpf="52998224725"),
    ])
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_full_name_is_required(app):
    db.session.add(Patient())
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_update_refreshes_updated_at(app):
    old_timestamp = datetime(2000, 1, 1, tzinfo=timezone.utc)
    patient = Patient(
        full_name="Ana",
        birth_date=date(1990, 5, 20),
        sex="F",
        created_at=old_timestamp,
        updated_at=old_timestamp,
    )
    db.session.add(patient)
    db.session.commit()
    patient_id = patient.id
    created_at = patient.created_at
    updated_at = patient.updated_at

    patient.full_name = "Ana Souza"
    db.session.commit()
    db.session.expunge_all()

    saved = db.session.get(Patient, patient_id)
    assert saved.full_name == "Ana Souza"
    assert saved.created_at == created_at
    assert saved.updated_at > updated_at


def test_migration_assigns_distinct_numbers_to_39_existing_patients_without_changing_ids(
    monkeypatch, tmp_path,
):
    monkeypatch.setattr(
        Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'legacy-patients.db'}"
    )
    legacy_app = create_app()
    legacy_app.config["TESTING"] = True
    try:
        with legacy_app.app_context():
            upgrade(revision="d4c8a91f2e67")
            with db.engine.begin() as connection:
                for patient_id in range(1, 40):
                    connection.execute(text("""
                        INSERT INTO patients
                            (id, full_name, birth_date, sex, is_active, created_at, updated_at)
                        VALUES (:id, :name, '1990-05-20', 'F', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """), {"id": patient_id, "name": f"Paciente {patient_id}"})
            upgrade()

            patients = Patient.query.order_by(Patient.id).all()
            record_numbers = [patient.record_number for patient in patients]
            assert len(patients) == 39
            assert len(set(record_numbers)) == 39
            assert [patient.id for patient in patients] == list(range(1, 40))
            assert db.session.get(PatientRecordNumberSequence, 1).current_value == 39
    finally:
        with legacy_app.app_context():
            db.session.remove()
            db.engine.dispose()


def test_record_number_migration_resumes_from_partial_mysql_ddl_shape(monkeypatch, tmp_path):
    monkeypatch.setattr(
        Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'partial-record-number.db'}"
    )
    legacy_app = create_app()
    legacy_app.config["TESTING"] = True
    try:
        with legacy_app.app_context():
            upgrade(revision="d4c8a91f2e67")
            with db.engine.begin() as connection:
                for patient_id in range(1, 4):
                    connection.execute(text("""
                        INSERT INTO patients
                            (id, full_name, birth_date, sex, is_active, created_at, updated_at)
                        VALUES (:id, :name, '1990-05-20', 'F', 1,
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """), {"id": patient_id, "name": f"Paciente {patient_id}"})
                # Match the durable first DDL operation left by the failed
                # MySQL migration: record_number exists, later objects do not.
                connection.execute(text(
                    "ALTER TABLE patients ADD COLUMN record_number VARCHAR(32) NULL"
                ))
                connection.execute(text("""
                    CREATE TABLE patient_record_number_sequence (
                        id SMALLINT NOT NULL PRIMARY KEY,
                        current_value BIGINT NOT NULL,
                        CONSTRAINT ck_patient_record_number_sequence_singleton CHECK (id = 1)
                    )
                """))
                connection.execute(text("""
                    CREATE TABLE patient_record_number_registry (
                        record_number VARCHAR(32) NOT NULL PRIMARY KEY,
                        patient_id INTEGER NULL,
                        is_consumed BOOLEAN NOT NULL
                    )
                """))
                connection.execute(text(
                    "UPDATE patients SET record_number='PR-000001' WHERE id=1"
                ))
                connection.execute(text(
                    "INSERT INTO patient_record_number_registry "
                    "VALUES ('PR-000001', 1, 1)"
                ))
                connection.execute(text(
                    "INSERT INTO patient_record_number_sequence VALUES (1, 7)"
                ))

            upgrade()
            values = db.session.execute(text(
                "SELECT id, record_number FROM patients ORDER BY id"
            )).all()
            assert values == [(1, "PR-000001"), (2, "PR-000002"), (3, "PR-000003")]
            assert db.session.execute(text(
                "SELECT current_value FROM patient_record_number_sequence WHERE id=1"
            )).scalar_one() == 7
            assert db.session.execute(text(
                "SELECT COUNT(*), COUNT(DISTINCT record_number) "
                "FROM patient_record_number_registry"
            )).one() == (3, 3)

            # Simulate DDL having completed while Alembic's version marker did
            # not advance, then ensure the same revisions can be retried.
            db.session.execute(text(
                "UPDATE alembic_version SET version_num='d4c8a91f2e67'"
            ))
            db.session.commit()
            upgrade()
            assert db.session.execute(text(
                "SELECT id, record_number FROM patients ORDER BY id"
            )).all() == values
            assert db.session.execute(text(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' "
                "AND name LIKE 'trg_patients_record_number_%'"
            )).scalar_one() == 3
    finally:
        with legacy_app.app_context():
            db.session.remove()
            db.engine.dispose()


def test_address_migration_resumes_after_some_columns_exist(monkeypatch, tmp_path):
    monkeypatch.setattr(
        Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'partial-address.db'}"
    )
    legacy_app = create_app()
    legacy_app.config["TESTING"] = True
    try:
        with legacy_app.app_context():
            upgrade(revision="f1a2b3c4d5e6")
            with db.engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE patients ADD COLUMN postal_code VARCHAR(8)"
                ))
                connection.execute(text(
                    "ALTER TABLE patients ADD COLUMN address VARCHAR(255)"
                ))

            upgrade()
            columns = {column["name"] for column in inspect(db.engine).get_columns("patients")}
            assert {"postal_code", "address", "address_number", "city", "state"} <= columns
            assert db.session.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "f3a4b5c6d7e8"
    finally:
        with legacy_app.app_context():
            db.session.remove()
            db.engine.dispose()


def test_mysql_record_number_sequence_pk_is_not_auto_increment():
    metadata = MetaData()
    sequence = Table(
        "patient_record_number_sequence",
        metadata,
        Column("id", SmallInteger(), primary_key=True, autoincrement=False),
        Column("current_value", db.BigInteger, nullable=False),
        CheckConstraint("id = 1", name="ck_patient_record_number_sequence_singleton"),
    )
    ddl = str(CreateTable(sequence).compile(dialect=mysql.dialect()))
    assert "AUTO_INCREMENT" not in ddl.upper()
    assert "CHECK (id = 1)" in ddl


def test_simultaneous_patient_creations_receive_distinct_numbers(app):
    barrier = Barrier(2)

    def create_patient(index):
        with app.app_context():
            barrier.wait(timeout=5)
            patient = Patient(
                full_name=f"Paciente Teste {index}",
                birth_date=date(1990, 5, 20),
                sex="F",
            )
            db.session.add(patient)
            db.session.commit()
            number = patient.record_number
            db.session.remove()
            return number

    with ThreadPoolExecutor(max_workers=2) as executor:
        numbers = list(executor.map(create_patient, (1, 2)))

    assert len(set(numbers)) == 2


def test_database_rejects_record_number_changes(app):
    patient = Patient(
        full_name="Maria Silva", birth_date=date(1990, 5, 20), sex="F"
    )
    db.session.add(patient)
    db.session.commit()
    patient_id = patient.id
    original_number = patient.record_number

    with pytest.raises(IntegrityError):
        db.session.execute(text(
            "UPDATE patients SET record_number = :number WHERE id = :id"
        ), {"number": "PR-999999", "id": patient_id})
        db.session.commit()
    db.session.rollback()

    saved = db.session.get(Patient, patient_id)
    assert saved.record_number == original_number

    db.session.delete(saved)
    db.session.commit()
    with pytest.raises(IntegrityError):
        db.session.execute(text("""
            INSERT INTO patients
                (id, record_number, full_name, birth_date, sex, is_active, created_at, updated_at)
            VALUES (999999, :number, 'Outro Paciente', '1990-05-20', 'F', 1,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """), {"number": original_number})
        db.session.commit()
    db.session.rollback()
