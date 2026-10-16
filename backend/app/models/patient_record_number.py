from app.extensions import db


class PatientRecordNumberSequence(db.Model):
    __tablename__ = "patient_record_number_sequence"
    __table_args__ = (db.CheckConstraint("id = 1", name="ck_patient_record_number_sequence_singleton"),)

    # The singleton CHECK constraint cannot reference AUTO_INCREMENT in MySQL.
    id = db.Column(db.SmallInteger, primary_key=True, autoincrement=False)
    current_value = db.Column(db.BigInteger, nullable=False)


class PatientRecordNumberRegistry(db.Model):
    """Permanent history of assigned numbers, independent of patient deletion."""

    __tablename__ = "patient_record_number_registry"

    record_number = db.Column(db.String(32), primary_key=True)
    patient_id = db.Column(db.Integer, nullable=True)
    is_consumed = db.Column(db.Boolean, nullable=False, default=False)
