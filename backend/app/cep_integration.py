"""Provider-agnostic CEP configuration, secret handling and lookup service."""

import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
import unicodedata
from urllib.parse import quote, urlsplit

from flask import current_app

from app.extensions import db
from app.models import CepIntegration


DEFAULT_PROVIDER = {
    "provider_name": "ViaCEP",
    "url_template": "https://viacep.com.br/ws/{cep}/json/",
    "method": "GET",
    "field_map": {
        "cep": "cep", "address": "logradouro",
        "city": "localidade", "state": "uf",
    },
}
FIELD_NAMES = ("cep", "address", "city", "state")
STATE_CODES = {
    "acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM",
    "bahia": "BA", "ceara": "CE", "distrito federal": "DF",
    "espirito santo": "ES", "goias": "GO", "maranhao": "MA",
    "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
    "para": "PA", "paraiba": "PB", "parana": "PR", "pernambuco": "PE",
    "piaui": "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN",
    "rio grande do sul": "RS", "rondonia": "RO", "roraima": "RR",
    "santa catarina": "SC", "sao paulo": "SP", "sergipe": "SE",
    "tocantins": "TO",
}
_VALID_FIELD_PATH = re.compile(r"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$")
_VALID_HEADER = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
_BLOCKED_AUTH_HEADERS = {
    "host", "cookie", "set-cookie", "content-length", "transfer-encoding",
    "connection", "proxy-authorization", "accept", "user-agent", "upgrade",
}
MAX_RESPONSE_BYTES = 1_048_576


class CepLookupError(Exception):
    def __init__(self, code, message, status):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _credential_cipher():
    keys = current_app.config.get("CEP_CREDENTIAL_ENCRYPTION_KEYS", ())
    if isinstance(keys, str):
        keys = tuple(key.strip() for key in keys.split(":") if key.strip())
    if not keys:
        raise RuntimeError("Criptografia de credenciais não configurada.")
    from cryptography.fernet import Fernet, MultiFernet

    return MultiFernet([Fernet(key.encode("ascii")) for key in keys])


def encrypt_credential(value):
    return _credential_cipher().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_credential(value):
    return _credential_cipher().decrypt(value.encode("ascii")).decode("utf-8")


def normalize_cep(value):
    if not isinstance(value, str):
        raise CepLookupError("cep_invalid", "Informe um CEP válido com 8 dígitos.", 400)
    candidate = value.strip()
    if not re.fullmatch(r"\d{5}-?\d{3}", candidate):
        raise CepLookupError("cep_invalid", "Informe um CEP válido com 8 dígitos.", 400)
    return candidate.replace("-", "")


def validate_field_map(field_map):
    if not isinstance(field_map, dict) or set(field_map) != set(FIELD_NAMES):
        raise ValueError("field_map deve mapear cep, address, city e state.")
    normalized = {}
    for field, path in field_map.items():
        if not isinstance(path, str) or not _VALID_FIELD_PATH.fullmatch(path):
            raise ValueError(f"Mapeamento inválido para {field}.")
        normalized[field] = path
    return normalized


def validate_auth_header(value):
    if value is None or value == "":
        return None
    if (not isinstance(value, str) or not _VALID_HEADER.fullmatch(value)
            or (value.lower() != "authorization" and not value.lower().startswith("x-"))):
        raise ValueError("Cabeçalho de autenticação inválido.")
    if value.lower() in _BLOCKED_AUTH_HEADERS:
        raise ValueError("Cabeçalho de autenticação não permitido.")
    return value


def validate_provider_config(data):
    if not isinstance(data, dict):
        raise ValueError("Envie um objeto JSON válido.")
    required = {"provider_name", "url_template", "method", "field_map"}
    if set(data) - (required | {"auth_header", "auth_prefix"}) or not required <= set(data):
        raise ValueError("Envie somente os campos de configuração documentados.")
    name = data["provider_name"]
    template = data["url_template"]
    method = data["method"]
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
        raise ValueError("provider_name deve conter de 1 a 120 caracteres.")
    if method != "GET":
        raise ValueError("Somente o método GET é permitido.")
    if not isinstance(template, str) or len(template) > 500 or template.count("{cep}") != 1:
        raise ValueError("url_template deve conter exatamente um placeholder {cep}.")
    parsed = urlsplit(template)
    allowed_hosts = {host.lower() for host in current_app.config.get("CEP_PROVIDER_ALLOWED_HOSTS", ())}
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.query or parsed.fragment
            or "{cep}" not in parsed.path or parsed.netloc.lower() != parsed.hostname.lower()
            or parsed.hostname.lower() not in allowed_hosts):
        raise ValueError("URL HTTPS fora da lista de destinos permitidos.")
    auth_header = validate_auth_header(data.get("auth_header"))
    auth_prefix = data.get("auth_prefix", "")
    if auth_prefix is None:
        auth_prefix = ""
    if auth_header is None and auth_prefix:
        raise ValueError("auth_prefix requer auth_header.")
    if (not isinstance(auth_prefix, str) or len(auth_prefix) > 40 or not auth_prefix.isascii()
            or any(ord(character) < 32 or ord(character) == 127 for character in auth_prefix)):
        raise ValueError("auth_prefix inválido.")
    return {
        "provider_name": name.strip(), "url_template": template,
        "method": "GET", "field_map": validate_field_map(data["field_map"]),
        "auth_header": auth_header, "auth_prefix": auth_prefix or None,
    }


def extract_path(payload, dotted_path):
    value = payload
    for part in dotted_path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    if value is None or isinstance(value, (dict, list)):
        return None
    return str(value).strip() or None


def normalize_state(value):
    if not isinstance(value, str) or not value.strip():
        return None
    state = " ".join(unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().casefold().split())
    if len(state) == 2 and state.upper() in set(STATE_CODES.values()):
        return state.upper()
    return STATE_CODES.get(state)


def _resolve_public_addresses(hostname):
    try:
        records = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise CepLookupError("provider_unavailable", "Provedor de CEP indisponível.", 503) from exc
    addresses = list(dict.fromkeys(record[4][0] for record in records))
    try:
        unsafe = any(not ipaddress.ip_address(address).is_global for address in addresses)
    except ValueError as exc:
        raise CepLookupError("provider_unavailable", "Destino do provedor não permitido.", 503) from exc
    if not addresses or unsafe:
        raise CepLookupError("provider_unavailable", "Destino do provedor não permitido.", 503)
    return addresses


def _https_get(url, headers, timeout):
    parsed = urlsplit(url)
    hostname = parsed.hostname
    addresses = _resolve_public_addresses(hostname)
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    context = ssl.create_default_context()
    last_error = None
    deadline = time.monotonic() + timeout
    for address in addresses:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CepLookupError("provider_timeout", "O provedor de CEP excedeu o tempo limite.", 504)
        raw_socket = None
        connection = None
        try:
            raw_socket = socket.socket(socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM)
            raw_socket.settimeout(remaining)
            destination = (address, 443, 0, 0) if ":" in address else (address, 443)
            raw_socket.connect(destination)
            tls_socket = context.wrap_socket(raw_socket, server_hostname=hostname)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CepLookupError("provider_timeout", "O provedor de CEP excedeu o tempo limite.", 504)
            tls_socket.settimeout(remaining)
            connection = http.client.HTTPSConnection(hostname, 443, timeout=remaining, context=context)
            connection.sock = tls_socket
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise CepLookupError("provider_invalid_response", "Resposta do provedor excede o limite permitido.", 502)
            if 300 <= response.status < 400:
                raise CepLookupError("provider_http_error", "O provedor retornou um redirecionamento não permitido.", 502)
            if not 200 <= response.status < 300:
                raise CepLookupError("provider_http_error", "O provedor de CEP retornou uma falha HTTP.", 502)
            return body
        except CepLookupError:
            raise
        except (TimeoutError, socket.timeout) as exc:
            raise CepLookupError("provider_timeout", "O provedor de CEP excedeu o tempo limite.", 504) from exc
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            last_error = exc
        finally:
            if connection is not None:
                connection.close()
            elif raw_socket is not None:
                raw_socket.close()
    raise CepLookupError("provider_unavailable", "Provedor de CEP indisponível.", 503) from last_error


def _state_of(integration):
    if integration is None:
        return CepIntegration(**DEFAULT_PROVIDER, is_active=True)
    return integration


def get_integration():
    return _state_of(CepIntegration.query.order_by(CepIntegration.id).first())


def lookup_cep(value):
    cep = normalize_cep(value)
    integration = get_integration()
    if not integration.is_active:
        raise CepLookupError("integration_disabled", "Consulta de CEP está desativada.", 409)
    try:
        validate_provider_config({
            "provider_name": integration.provider_name,
            "url_template": integration.url_template,
            "method": integration.method,
            "field_map": integration.field_map,
            "auth_header": integration.auth_header,
            "auth_prefix": integration.auth_prefix or "",
        })
    except ValueError as exc:
        raise CepLookupError("provider_unavailable", "Configuração do provedor inválida ou não permitida.", 503) from exc
    url = integration.url_template.replace("{cep}", quote(cep, safe=""))
    headers = {"Accept": "application/json", "User-Agent": "TCQ-Clinic/1.0"}
    if integration.auth_header:
        if not integration.credential_ciphertext:
            raise CepLookupError("provider_unavailable", "Credencial do provedor não configurada.", 503)
        try:
            credential = decrypt_credential(integration.credential_ciphertext)
        except Exception as exc:
            raise CepLookupError("provider_unavailable", "Credencial do provedor indisponível.", 503) from exc
        if "\r" in credential or "\n" in credential:
            raise CepLookupError("provider_unavailable", "Credencial do provedor inválida.", 503)
        headers[integration.auth_header] = f"{integration.auth_prefix or ''}{credential}"
    try:
        body = _https_get(url, headers, current_app.config.get("CEP_PROVIDER_TIMEOUT_SECONDS", 3))
    except CepLookupError:
        raise
    except (TimeoutError, socket.timeout) as exc:
        raise CepLookupError("provider_timeout", "O provedor de CEP excedeu o tempo limite.", 504) from exc
    except OSError as exc:
        raise CepLookupError("provider_unavailable", "Provedor de CEP indisponível.", 503) from exc
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CepLookupError("provider_invalid_response", "O provedor retornou JSON inválido.", 502) from exc
    if not isinstance(payload, dict):
        raise CepLookupError("provider_invalid_response", "O provedor retornou JSON inválido.", 502)
    if payload.get("erro") is True or (isinstance(payload.get("erro"), str) and payload["erro"].strip().lower() == "true"):
        raise CepLookupError("cep_not_found", "CEP não encontrado.", 404)
    result = {field: extract_path(payload, integration.field_map[field]) for field in FIELD_NAMES}
    result["cep"] = re.sub(r"\D", "", result["cep"] or cep)
    result["state"] = normalize_state(result["state"])
    if (len(result["cep"]) != 8 or not result["address"] or not result["city"]
            or not result["state"]):
        raise CepLookupError("provider_invalid_response", "O provedor retornou dados incompletos ou inválidos.", 502)
    result["cep"] = f"{result['cep'][:5]}-{result['cep'][5:]}"
    return result


def serialize_integration(integration):
    return {
        "provider_name": integration.provider_name,
        "url_template": integration.url_template,
        "method": integration.method,
        "field_map": integration.field_map,
        "auth_header": integration.auth_header,
        "auth_prefix": integration.auth_prefix,
        "credential_configured": bool(integration.credential_ciphertext),
        "is_active": integration.is_active,
    }


def save_integration(data):
    if not isinstance(data, dict):
        raise ValueError("Envie um objeto JSON válido.")
    allowed = {
        "provider_name", "url_template", "method", "field_map",
        "auth_header", "auth_prefix", "is_active",
    }
    if set(data) - allowed:
        raise ValueError("Envie somente os campos de configuração documentados.")
    if "is_active" in data and type(data["is_active"]) is not bool:
        raise ValueError("is_active deve ser booleano.")

    integration = CepIntegration.query.order_by(CepIntegration.id).first()

    # Deactivation is a state transition, not a configuration update. Ignore
    # known configuration fields in this request so partial/blank form values
    # cannot prevent disabling or replace the last usable configuration.
    if data.get("is_active") is False:
        if integration is None:
            config = validate_provider_config(DEFAULT_PROVIDER)
            integration = CepIntegration(**config, is_active=False)
            db.session.add(integration)
        else:
            integration.is_active = False
        db.session.commit()
        return integration

    existing = integration or _state_of(None)
    config_data = {
        field: getattr(existing, field)
        for field in (
            "provider_name", "url_template", "method", "field_map",
            "auth_header", "auth_prefix",
        )
    }
    config_data.update({field: value for field, value in data.items() if field != "is_active"})
    if config_data["auth_prefix"] is None:
        config_data["auth_prefix"] = ""
    if "auth_header" in data and data["auth_header"] in (None, "") and "auth_prefix" not in data:
        config_data["auth_prefix"] = ""

    # Validate the complete effective configuration before changing either
    # its persisted fields or activation state. This also makes reactivation
    # validate the stored values when the request contains only is_active.
    config = validate_provider_config(config_data)
    if integration is None:
        integration = CepIntegration(**config, is_active=data.get("is_active", True))
        db.session.add(integration)
    else:
        identity_fields = ("provider_name", "url_template", "auth_header", "auth_prefix")
        if any(getattr(integration, field) != config[field] for field in identity_fields):
            integration.credential_ciphertext = None
        for field, value in config.items():
            setattr(integration, field, value)
        if "is_active" in data:
            integration.is_active = data["is_active"]
    db.session.commit()
    return integration


def save_credential(value):
    if (not isinstance(value, str) or not value or len(value) > 4096 or not value.isascii()
            or any(ord(character) < 32 or ord(character) == 127 for character in value)):
        raise ValueError("credential deve conter de 1 a 4096 caracteres sem quebras de linha.")
    integration = get_integration()
    if integration.auth_header is None:
        raise ValueError("Esta configuração não exige credencial.")
    if integration.id is None:
        config = validate_provider_config({
            "provider_name": integration.provider_name,
            "url_template": integration.url_template,
            "method": integration.method,
            "field_map": integration.field_map,
        })
        integration = CepIntegration(**config)
    try:
        ciphertext = encrypt_credential(value)
    except Exception as exc:
        raise RuntimeError("Criptografia de credenciais não configurada.") from exc
    integration.credential_ciphertext = ciphertext
    db.session.add(integration)
    db.session.commit()
    return integration
