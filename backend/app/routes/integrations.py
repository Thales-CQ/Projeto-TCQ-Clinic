"""Administration and lookup routes for the CEP provider."""

from flask import Blueprint, jsonify, request

from app.cep_integration import (
    CepLookupError,
    get_integration,
    lookup_cep,
    save_credential,
    save_integration,
    serialize_integration,
)
from app.permission_security import require_permission
from app.security import protect_csrf


integrations_bp = Blueprint("integrations", __name__)
integrations_bp.before_request(protect_csrf)


@integrations_bp.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@integrations_bp.get("/cep")
@require_permission("integrations.cep.view")
def get_cep_configuration():
    return jsonify({"integration": serialize_integration(get_integration())})


@integrations_bp.put("/cep/configuration")
@require_permission("integrations.cep.configure")
def put_cep_configuration():
    data = request.get_json(silent=True) if request.is_json else None
    try:
        integration = save_integration(data)
    except ValueError as exc:
        return jsonify({"error": {"code": "configuration_invalid", "message": str(exc)}}), 400
    return jsonify({"integration": serialize_integration(integration)})


@integrations_bp.put("/cep/credential")
@require_permission("integrations.cep.manage")
def put_cep_credential():
    data = request.get_json(silent=True) if request.is_json else None
    if not isinstance(data, dict) or set(data) != {"credential"}:
        return jsonify({"error": {"code": "payload_invalid", "message": "Envie somente o campo credential."}}), 400
    try:
        integration = save_credential(data["credential"])
    except ValueError as exc:
        return jsonify({"error": {"code": "credential_invalid", "message": str(exc)}}), 400
    except RuntimeError:
        return jsonify({"error": {"code": "credential_storage_unavailable", "message": "Armazenamento seguro da credencial indisponível."}}), 503
    return jsonify({"integration": serialize_integration(integration)})


@integrations_bp.get("/cep/lookup")
@require_permission("integrations.cep.lookup")
def lookup_cep_route():
    try:
        result = lookup_cep(request.args.get("cep"))
    except CepLookupError as exc:
        return jsonify({"error": {"code": exc.code, "message": exc.message}}), exc.status
    return jsonify({"address": result})
