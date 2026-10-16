from datetime import date

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import extract, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.extensions import db
from app.models import Patient
from app.patient_search import normalize_patient_search, normalized_patient_column
from app.permission_security import has_permission, require_permission
from app.security import protect_csrf, resolve_active_user
from app.validators.patient import PATIENT_VALIDATORS, validate_patient


patients_bp = Blueprint("patients", __name__)
patients_bp.before_request(protect_csrf)


@patients_bp.errorhandler(SQLAlchemyError)
def handle_database_error(exc):
    db.session.rollback()
    current_app.logger.exception("Falha de banco de dados em uma rota de pacientes.")
    return jsonify({
        "error": "Não foi possível concluir a operação no momento.",
        "code": "database_error",
    }), 500


@patients_bp.before_request
def require_authentication():
    if resolve_active_user() is None:
        return jsonify({"error": "Não autenticado."}), 401
    return None


@patients_bp.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


def _serialize_patient(patient):
    return {
        "id": patient.id,
        "record_number": patient.record_number,
        "full_name": patient.full_name,
        "birth_date": patient.birth_date.isoformat() if patient.birth_date else None,
        "sex": patient.sex,
        "cpf": patient.cpf,
        "phone": patient.phone,
        "email": patient.email,
        "is_active": patient.is_active,
        "created_at": patient.created_at.isoformat(),
        "updated_at": patient.updated_at.isoformat(),
        "postal_code": patient.postal_code,
        "address": patient.address,
        "address_number": patient.address_number,
        "city": patient.city,
        "state": patient.state,
    }


def _serialize_birthday_patient(patient):
    return {
        "id": patient.id,
        "record_number": patient.record_number,
        "full_name": patient.full_name,
        "birth_date": patient.birth_date.isoformat(),
    }


_MAX_PAGINATION_INTEGER = (1 << 63) - 1


@patients_bp.get("/birthdays/today")
@require_permission("patients.view")
def list_today_birthdays():
    today = date.today()
    patients = Patient.query.filter(
        Patient.is_active.is_(True),
        extract("month", Patient.birth_date) == today.month,
        extract("day", Patient.birth_date) == today.day,
    ).order_by(Patient.id.asc()).all()
    return jsonify({
        "patients": [_serialize_birthday_patient(patient) for patient in patients],
    })


@patients_bp.get("/<int:patient_id>")
@require_permission("patients.view")
def get_patient(patient_id):
    patient = db.session.get(Patient, patient_id)
    if patient is None:
        return jsonify({"error": "Paciente não encontrado."}), 404
    return jsonify({"patient": _serialize_patient(patient)})


@patients_bp.patch("/<int:patient_id>/status")
@require_permission("patients.change_status")
def update_patient_status(patient_id):
    patient = db.session.get(Patient, patient_id)
    if patient is None:
        return jsonify({"error": "Paciente não encontrado."}), 404

    if not request.is_json:
        return jsonify({"error": "Envie um objeto JSON válido."}), 400

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Envie um objeto JSON válido."}), 400
    if set(data) != {"is_active"}:
        return jsonify({
            "error": "Envie somente o campo is_active.",
            "fields": sorted(set(data) - {"is_active"}),
        }), 400
    if not isinstance(data["is_active"], bool):
        return jsonify({"error": "is_active deve ser booleano."}), 400

    patient.is_active = data["is_active"]
    db.session.commit()
    return jsonify({"patient": _serialize_patient(patient)})


@patients_bp.patch("/<int:patient_id>")
@require_permission("patients.update")
def update_patient(patient_id):
    patient = db.session.get(Patient, patient_id)
    if patient is None:
        return jsonify({"error": "Paciente não encontrado."}), 404

    if not request.is_json:
        return jsonify({"error": "Envie um objeto JSON válido."}), 400

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Envie um objeto JSON válido."}), 400
    if "is_active" in data and not has_permission(resolve_active_user(), "patients.change_status"):
        return jsonify({"error": "Permissão insuficiente."}), 403

    allowed_fields = set(PATIENT_VALIDATORS) | {"is_active"}
    unknown_fields = sorted(set(data) - allowed_fields)
    if unknown_fields:
        return jsonify({
            "error": "Campos não permitidos.",
            "fields": unknown_fields,
        }), 400

    if "is_active" in data and not isinstance(data["is_active"], bool):
        return jsonify({
            "error": "Dados inválidos.",
            "errors": {"is_active": "is_active deve ser booleano."},
        }), 400

    editable_data = {field: value for field, value in data.items() if field != "is_active"}
    normalized, errors = validate_patient(editable_data, partial=True)
    if errors:
        return jsonify({"error": "Dados inválidos.", "errors": errors}), 400
    if not normalized and "is_active" not in data:
        return jsonify({"error": "Informe ao menos um campo para atualizar."}), 400

    cpf = normalized.get("cpf")
    if cpf is not None and Patient.query.filter(
        Patient.cpf == cpf, Patient.id != patient.id
    ).first() is not None:
        return jsonify({"error": "CPF já cadastrado."}), 409

    for field, value in normalized.items():
        setattr(patient, field, value)
    if "is_active" in data:
        patient.is_active = data["is_active"]

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        if cpf is not None and Patient.query.filter(
            Patient.cpf == cpf, Patient.id != patient.id
        ).first() is not None:
            return jsonify({"error": "CPF já cadastrado."}), 409
        raise

    return jsonify({"patient": _serialize_patient(patient)})


@patients_bp.get("")
@require_permission("patients.view")
def list_patients():
    try:
        page = int(request.args.get("page", "1"))
        per_page = int(request.args.get("per_page", "20"))
    except ValueError:
        return jsonify({"error": "Paginação inválida."}), 400
    if page < 1 or per_page < 1 or per_page > 100:
        return jsonify({"error": "Paginação inválida."}), 400
    # SQLite binds signed 64-bit integers; keep page and OFFSET safe on both DBs.
    if page > _MAX_PAGINATION_INTEGER or (page - 1) * per_page > _MAX_PAGINATION_INTEGER:
        return jsonify({"error": "Paginação inválida."}), 400

    raw_search = request.args.get("search", "").strip()
    search = normalize_patient_search(raw_search)
    query = Patient.query
    if raw_search and not search:
        query = query.filter(False)
    elif search:
        search_pattern = f"%{search}%"
        query = query.filter(or_(
            normalized_patient_column(Patient.full_name).like(search_pattern),
            normalized_patient_column(Patient.cpf).like(search_pattern),
            normalized_patient_column(Patient.phone).like(search_pattern),
        ))

    pagination = query.order_by(
        normalized_patient_column(Patient.full_name).asc(),
        Patient.id.asc(),
    ).paginate(
        page=page, per_page=per_page, error_out=False
    )
    return jsonify({
        "patients": [_serialize_patient(patient) for patient in pagination.items],
        "page": page,
        "per_page": per_page,
        "total": pagination.total,
    })


@patients_bp.post("")
@require_permission("patients.create")
def create_patient():
    if not request.is_json:
        return jsonify({"error": "Envie um objeto JSON válido."}), 400

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Envie um objeto JSON válido."}), 400

    unknown_fields = sorted(set(data) - PATIENT_VALIDATORS.keys())
    if unknown_fields:
        return jsonify({
            "error": "Campos não permitidos.",
            "fields": unknown_fields,
        }), 400

    normalized, errors = validate_patient(data)
    if errors:
        return jsonify({"error": "Dados inválidos.", "errors": errors}), 400

    cpf = normalized.get("cpf")
    if cpf is not None and Patient.query.filter_by(cpf=cpf).first() is not None:
        return jsonify({"error": "CPF já cadastrado."}), 409

    patient = Patient(**normalized)
    db.session.add(patient)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        if cpf is not None and Patient.query.filter_by(cpf=cpf).first() is not None:
            return jsonify({"error": "CPF já cadastrado."}), 409
        raise

    return jsonify({"patient": _serialize_patient(patient)}), 201
