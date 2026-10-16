from datetime import datetime, timezone

from sqlalchemy import event, inspect, insert, select, update

from app.extensions import db


class Patient(db.Model):
    __tablename__ = "patients"

    id = db.Column(db.Integer, primary_key=True)
    record_number = db.Column(db.String(32), nullable=False, unique=True)
    full_name = db.Column(db.String(150), nullable=False)
    birth_date = db.Column(db.Date, nullable=False)
    sex = db.Column(db.String(1), nullable=False)
    cpf = db.Column(db.String(11), nullable=True, unique=True, index=True)
    phone = db.Column(db.String(20), nullable=True)
    email = db.Column(db.String(254), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    postal_code = db.Column(db.String(8), nullable=True)
    address = db.Column(db.String(255), nullable=True)
    address_number = db.Column(db.String(20), nullable=True)
    city = db.Column(db.String(120), nullable=True)
    state = db.Column(db.String(2), nullable=True)


@event.listens_for(Patient, "before_insert")
def assign_patient_record_number(mapper, connection, patient):
    """Allocate a permanent number from the transactional database sequence."""
    from .patient_record_number import (
        PatientRecordNumberRegistry,
        PatientRecordNumberSequence,
    )

    if patient.record_number is not None:
        raise ValueError("record_number é gerado pelo sistema.")

    sequence = PatientRecordNumberSequence.__table__
    result = connection.execute(
        update(sequence)
        .where(sequence.c.id == 1)
        .values(current_value=sequence.c.current_value + 1)
    )
    if result.rowcount != 1:
        raise RuntimeError("Sequência de prontuários não inicializada.")

    value = connection.execute(
        select(sequence.c.current_value).where(sequence.c.id == 1)
    ).scalar_one()
    patient.record_number = f"PR-{value:06d}"
    connection.execute(
        insert(PatientRecordNumberRegistry.__table__).values(
            record_number=patient.record_number,
            patient_id=None,
            is_consumed=False,
        )
    )


@event.listens_for(Patient, "after_insert")
def preserve_patient_record_number(mapper, connection, patient):
    """Keep a permanent allocation ledger even if a patient is later deleted."""
    from .patient_record_number import PatientRecordNumberRegistry

    registry = PatientRecordNumberRegistry.__table__
    connection.execute(
        update(registry)
        .where(registry.c.record_number == patient.record_number)
        .values(patient_id=patient.id, is_consumed=True)
    )


@event.listens_for(Patient, "before_update")
def prevent_patient_record_number_change(mapper, connection, patient):
    if inspect(patient).attrs.record_number.history.has_changes():
        raise ValueError("record_number é imutável.")
