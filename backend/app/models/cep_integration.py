from datetime import datetime, timezone

from app.extensions import db


class CepIntegration(db.Model):
    __tablename__ = "cep_integrations"

    id = db.Column(db.Integer, primary_key=True)
    provider_name = db.Column(db.String(120), nullable=False)
    url_template = db.Column(db.String(500), nullable=False)
    method = db.Column(db.String(10), nullable=False, default="GET")
    field_map = db.Column(db.JSON, nullable=False)
    auth_header = db.Column(db.String(120), nullable=True)
    auth_prefix = db.Column(db.String(40), nullable=True)
    credential_ciphertext = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
