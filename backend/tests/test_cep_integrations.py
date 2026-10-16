import json

import pytest
from cryptography.fernet import Fernet

from app import create_app
from app.config import Config
from app.extensions import db
from app.models import CepIntegration, Permission, Profile, User


BASE = "/api/v1/integrations/cep"
ALL_PERMISSIONS = (
    "integrations.cep.view", "integrations.cep.configure",
    "integrations.cep.manage", "integrations.cep.lookup",
)
CONFIG = {
    "provider_name": "ViaCEP",
    "url_template": "https://viacep.com.br/ws/{cep}/json/",
    "method": "GET",
    "field_map": {
        "cep": "cep", "address": "logradouro",
        "city": "localidade", "state": "uf",
    },
}


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(Config, "SQLALCHEMY_DATABASE_URI", "sqlite:///:memory:")
    monkeypatch.setattr(Config, "SECRET_KEY", "cep-integration-test-secret")
    monkeypatch.setattr(Config, "SESSION_COOKIE_SECURE", False)
    monkeypatch.setattr(Config, "CEP_PROVIDER_ALLOWED_HOSTS", ("viacep.com.br", "api.example.test"))
    monkeypatch.setattr(Config, "CEP_CREDENTIAL_ENCRYPTION_KEYS", (Fernet.generate_key().decode(),))
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        db.create_all()
        permissions = [Permission(code=code, description=code) for code in ALL_PERMISSIONS]
        admin = Profile(name="Administrador", permissions=permissions)
        view_only = Profile(name="Leitura", permissions=[permissions[0]])
        manage_only = Profile(name="Credencial", permissions=[permissions[2]])
        configure_only = Profile(name="Configuração", permissions=[permissions[1]])
        lookup_only = Profile(name="Consulta", permissions=[permissions[3]])
        users = [User(username=name, profiles=[profile]) for name, profile in (
            ("admin", admin), ("viewer", view_only), ("manager", manage_only),
            ("configurer", configure_only), ("lookup", lookup_only),
        )]
        for user in users:
            user.set_password("test-password-123")
        db.session.add_all(users)
        db.session.commit()
    yield app
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def client_as(app, username):
    client = app.test_client()
    with app.app_context():
        user_id = User.query.filter_by(username=username.upper()).one().id
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client


def write(client, method, path, payload):
    token = client.get("/api/v1/auth/me").json["csrf_token"]
    return getattr(client, method)(path, json=payload, headers={
        "X-CSRF-Token": token, "Origin": "http://localhost",
    })


def test_integration_routes_enforce_separate_permissions_and_do_not_return_credentials(app):
    assert app.test_client().get(BASE).status_code == 401
    viewer = client_as(app, "viewer")
    assert viewer.get(BASE).status_code == 200
    assert viewer.get(BASE).json["integration"]["provider_name"] == "ViaCEP"
    assert viewer.get(BASE).headers["Cache-Control"] == "no-store"
    assert write(viewer, "put", BASE + "/configuration", CONFIG).status_code == 403
    assert write(viewer, "put", BASE + "/credential", {"credential": "secret"}).status_code == 403
    assert client_as(app, "manager").get(BASE).status_code == 403
    assert client_as(app, "configurer").get(BASE + "/lookup?cep=01001000").status_code == 403


def test_configuration_and_credential_are_separate_and_secret_is_never_serialized(app):
    configurer = client_as(app, "configurer")
    configured = write(configurer, "put", BASE + "/configuration", {
        "provider_name": "Outro provedor", "url_template": "https://api.example.test/v1/{cep}",
        "method": "GET", "field_map": {
            "cep": "data.postal_code", "address": "data.location.street",
            "city": "data.location.city", "state": "data.location.state_name",
        }, "auth_header": "X-API-Key", "auth_prefix": "Token ",
    })
    assert configured.status_code == 200, configured.json
    assert configured.json["integration"]["field_map"]["address"] == "data.location.street"
    assert configured.json["integration"]["auth_prefix"] == "Token "
    assert configured.json["integration"]["credential_configured"] is False

    manager = client_as(app, "manager")
    secret = "private-provider-token-91"
    response = write(manager, "put", BASE + "/credential", {"credential": secret})
    assert response.status_code == 200
    assert secret not in response.get_data(as_text=True)
    assert response.json["integration"]["credential_configured"] is True
    assert response.headers["Cache-Control"] == "no-store"
    with app.app_context():
        integration = CepIntegration.query.one()
        assert secret not in integration.credential_ciphertext
        assert integration.credential_ciphertext
        assert secret not in write(client_as(app, "admin"), "get", BASE, {}).get_data(as_text=True)


def test_configuration_contract_accepts_only_writable_fields(app):
    admin = client_as(app, "admin")
    current = admin.get(BASE).json["integration"]
    assert set(current) == {
        "provider_name", "url_template", "method", "field_map", "auth_header",
        "auth_prefix", "credential_configured", "is_active",
    }

    accepted = write(admin, "put", BASE + "/configuration", {
        **CONFIG, "is_active": True, "auth_header": "X-API-Key", "auth_prefix": "Token ",
    })
    assert accepted.status_code == 200, accepted.json

    for field, value in (
        ("credential_configured", False),
        ("field_mapping", CONFIG["field_map"]),
        ("auth_type", "api_key"),
    ):
        rejected = write(admin, "put", BASE + "/configuration", {**CONFIG, field: value})
        assert rejected.status_code == 400, (field, rejected.json)
        assert rejected.json["error"]["code"] == "configuration_invalid"
        assert rejected.json["error"]["message"] == "Envie somente os campos de configuração documentados."


@pytest.mark.parametrize("change", [
    {"url_template": "http://viacep.com.br/ws/{cep}/json/"},
    {"url_template": "https://127.0.0.1/{cep}"},
    {"url_template": "https://not-allowed.example/{cep}"},
    {"url_template": "https://user:pass@viacep.com.br/{cep}"},
    {"url_template": "https://viacep.com.br/{cep}?next=https://example.com"},
    {"method": "POST"},
    {"field_map": {"cep": "cep", "address": "address", "city": "city"}},
    {"field_map": {"cep": "data[0].cep", "address": "address", "city": "city", "state": "uf"}},
])
def test_configuration_rejects_unsafe_urls_and_invalid_mappings(app, change):
    payload = {**CONFIG, **change}
    response = write(client_as(app, "admin"), "put", BASE + "/configuration", payload)
    assert response.status_code == 400


def test_changing_destination_clears_existing_credential(app):
    client = client_as(app, "admin")
    write(client, "put", BASE + "/configuration", {
        **CONFIG, "auth_header": "X-API-Key",
    })
    write(client, "put", BASE + "/credential", {"credential": "secret-value"})
    response = write(client, "put", BASE + "/configuration", {
        **CONFIG, "url_template": "https://api.example.test/{cep}", "auth_header": "X-API-Key",
    })
    assert response.status_code == 200
    assert response.json["integration"]["credential_configured"] is False


def test_lookup_returns_a_normalized_response(app, monkeypatch):
    from app import cep_integration

    with app.app_context():
        db.session.add(CepIntegration(**CONFIG, is_active=True))
        db.session.commit()
    response_body = json.dumps({
        "cep": "01001-000", "logradouro": "Praça da Sé", "localidade": "São Paulo",
        "uf": "São Paulo",
    }).encode()
    calls = []
    monkeypatch.setattr(cep_integration, "_https_get", lambda url, headers, timeout: calls.append((url, headers)) or response_body)
    response = client_as(app, "lookup").get(BASE + "/lookup?cep=01001000")
    assert response.status_code == 200
    assert response.json == {"address": {
        "cep": "01001-000", "address": "Praça da Sé", "city": "São Paulo", "state": "SP",
    }}
    assert calls[0][0] == "https://viacep.com.br/ws/01001000/json/"


def test_nested_mapping_and_credential_are_used_only_for_the_provider(app, monkeypatch):
    from app import cep_integration

    with app.app_context():
        from app.cep_integration import encrypt_credential

        integration = CepIntegration(
            provider_name="Provedor aninhado", url_template="https://api.example.test/v1/{cep}",
            method="GET", field_map={
                "cep": "data.postal.code", "address": "data.address.street",
                "city": "data.address.city", "state": "data.address.state",
            }, auth_header="X-API-Key", credential_ciphertext=encrypt_credential("outbound-secret"),
        )
        db.session.add(integration)
        db.session.commit()
    body = json.dumps({"data": {"postal": {"code": "01001000"}, "address": {
        "street": "Praça da Sé", "city": "São Paulo", "state": "São Paulo",
    }}}).encode()
    calls = []

    def fake_request(url, headers, timeout):
        calls.append((url, headers, timeout))
        return body

    monkeypatch.setattr(cep_integration, "_https_get", fake_request)
    response = client_as(app, "lookup").get(BASE + "/lookup?cep=01001000")
    assert response.status_code == 200
    assert response.json["address"]["state"] == "SP"
    assert "outbound-secret" not in response.get_data(as_text=True)
    assert calls[0][1]["X-API-Key"] == "outbound-secret"


@pytest.mark.parametrize(("body", "status", "code"), [
    (b'{"erro":true}', 404, "cep_not_found"),
    (b'{"erro":"true"}', 404, "cep_not_found"),
    (b"not-json", 502, "provider_invalid_response"),
])
def test_lookup_normalizes_provider_errors(app, monkeypatch, body, status, code):
    from app import cep_integration

    with app.app_context():
        db.session.add(CepIntegration(**CONFIG, is_active=True))
        db.session.commit()
    monkeypatch.setattr(cep_integration, "_https_get", lambda *args: body)
    response = client_as(app, "lookup").get(BASE + "/lookup?cep=01001000")
    assert response.status_code == status
    assert response.json["error"]["code"] == code


def test_invalid_cep_is_rejected_before_provider_call(app, monkeypatch):
    from app import cep_integration

    monkeypatch.setattr(cep_integration, "_https_get", lambda *args: pytest.fail("não deve consultar"))
    response = client_as(app, "lookup").get(BASE + "/lookup?cep=1234x678")
    assert response.status_code == 400
    assert response.json["error"]["code"] == "cep_invalid"


def test_resolver_rejects_non_public_addresses(app, monkeypatch):
    import socket

    from app import cep_integration
    from app.cep_integration import CepLookupError

    monkeypatch.setattr(cep_integration.socket, "getaddrinfo", lambda *args, **kwargs: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443)),
    ])
    with app.app_context(), pytest.raises(CepLookupError) as error:
        cep_integration._resolve_public_addresses("viacep.com.br")
    assert error.value.code == "provider_unavailable"


def test_https_client_does_not_follow_provider_redirects(app, monkeypatch):
    from app import cep_integration
    from app.cep_integration import CepLookupError

    class FakeSocket:
        def settimeout(self, _timeout):
            pass

        def connect(self, _address):
            pass

        def close(self):
            pass

    class FakeTLSContext:
        def wrap_socket(self, raw_socket, server_hostname):
            assert server_hostname == "viacep.com.br"
            return raw_socket

    class FakeResponse:
        status = 302

        def read(self, _maximum):
            return b"redirect"

    class FakeConnection:
        instances = []

        def __init__(self, *_args, **_kwargs):
            self.requests = []
            self.instances.append(self)

        def request(self, method, path, headers):
            self.requests.append((method, path, headers))

        def getresponse(self):
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr(cep_integration, "_resolve_public_addresses", lambda _host: ["93.184.216.34"])
    monkeypatch.setattr(cep_integration.socket, "socket", lambda *_args, **_kwargs: FakeSocket())
    monkeypatch.setattr(cep_integration.ssl, "create_default_context", FakeTLSContext)
    monkeypatch.setattr(cep_integration.http.client, "HTTPSConnection", FakeConnection)
    with app.app_context(), pytest.raises(CepLookupError) as error:
        cep_integration._https_get("https://viacep.com.br/ws/01001000/json/", {}, 1)
    assert error.value.code == "provider_http_error"
    assert len(FakeConnection.instances[0].requests) == 1


@pytest.mark.parametrize(("failure", "status", "code"), [
    (TimeoutError(), 504, "provider_timeout"),
    (OSError("connection details must not leak"), 503, "provider_unavailable"),
])
def test_lookup_maps_provider_transport_errors(app, monkeypatch, failure, status, code):
    from app import cep_integration

    with app.app_context():
        db.session.add(CepIntegration(**CONFIG, is_active=True))
        db.session.commit()

    def fail_request(*args):
        raise failure

    monkeypatch.setattr(cep_integration, "_https_get", fail_request)
    response = client_as(app, "lookup").get(BASE + "/lookup?cep=01001000")
    assert response.status_code == status
    assert response.json["error"]["code"] == code
    assert "connection details" not in response.get_data(as_text=True)


def test_deactivation_accepts_incomplete_form_and_preserves_saved_configuration(app):
    admin = client_as(app, "admin")
    configured = write(admin, "put", BASE + "/configuration", {
        **CONFIG, "auth_header": "X-API-Key", "auth_prefix": "Token ",
    })
    assert configured.status_code == 200
    credential = write(admin, "put", BASE + "/credential", {"credential": "stored-secret"})
    assert credential.status_code == 200

    disabled = write(admin, "put", BASE + "/configuration", {
        "is_active": False,
        "provider_name": "",
        "url_template": "",
        "method": "",
        "field_map": {},
        "auth_header": "",
        "auth_prefix": "",
    })

    assert disabled.status_code == 200, disabled.json
    assert disabled.json["integration"] == {
        "provider_name": "ViaCEP",
        "url_template": CONFIG["url_template"],
        "method": "GET",
        "field_map": CONFIG["field_map"],
        "auth_header": "X-API-Key",
        "auth_prefix": "Token ",
        "credential_configured": True,
        "is_active": False,
    }
    with app.app_context():
        saved = CepIntegration.query.one()
        assert saved.credential_ciphertext


def test_reactivation_uses_and_validates_the_preserved_configuration(app):
    admin = client_as(app, "admin")
    disabled = write(admin, "put", BASE + "/configuration", {"is_active": False})
    assert disabled.status_code == 200 and disabled.json["integration"]["is_active"] is False

    enabled = write(admin, "put", BASE + "/configuration", {"is_active": True})
    assert enabled.status_code == 200, enabled.json
    assert enabled.json["integration"]["is_active"] is True
    assert enabled.json["integration"]["url_template"] == CONFIG["url_template"]

    with app.app_context():
        saved = CepIntegration.query.one()
        saved.is_active = False
        saved.url_template = ""
        db.session.commit()

    rejected = write(admin, "put", BASE + "/configuration", {"is_active": True})
    assert rejected.status_code == 400
    assert rejected.json["error"]["code"] == "configuration_invalid"
    with app.app_context():
        saved = CepIntegration.query.one()
        assert saved.is_active is False and saved.url_template == ""

    repaired = write(admin, "put", BASE + "/configuration", {
        **CONFIG, "is_active": True,
    })
    assert repaired.status_code == 200, repaired.json
    assert repaired.json["integration"]["is_active"] is True


def test_empty_optional_auth_fields_are_normalized_and_accepted(app):
    admin = client_as(app, "admin")
    configured = write(admin, "put", BASE + "/configuration", {
        **CONFIG, "auth_header": "X-API-Key", "auth_prefix": "Bearer ",
    })
    assert configured.status_code == 200
    assert write(admin, "put", BASE + "/credential", {"credential": "old-secret"}).status_code == 200

    cleared = write(admin, "put", BASE + "/configuration", {
        **CONFIG, "auth_header": "", "auth_prefix": "",
    })
    assert cleared.status_code == 200, cleared.json
    assert cleared.json["integration"]["auth_header"] is None
    assert cleared.json["integration"]["auth_prefix"] is None
    assert cleared.json["integration"]["credential_configured"] is False

    cleared_header_only = write(admin, "put", BASE + "/configuration", {
        **CONFIG, "auth_header": None,
    })
    assert cleared_header_only.status_code == 200, cleared_header_only.json
    assert cleared_header_only.json["integration"]["auth_prefix"] is None

    cleared_nulls = write(admin, "put", BASE + "/configuration", {
        **CONFIG, "auth_header": None, "auth_prefix": None,
    })
    assert cleared_nulls.status_code == 200, cleared_nulls.json
    assert cleared_nulls.json["integration"]["auth_header"] is None
    assert cleared_nulls.json["integration"]["auth_prefix"] is None


@pytest.mark.parametrize("change", [
    {"provider_name": ""},
    {"url_template": ""},
    {"field_map": {"cep": "", "address": "logradouro", "city": "localidade", "state": "uf"}},
])
def test_invalid_active_configuration_is_rejected_without_changing_saved_values(app, change):
    admin = client_as(app, "admin")
    before = write(admin, "put", BASE + "/configuration", CONFIG)
    assert before.status_code == 200

    rejected = write(admin, "put", BASE + "/configuration", {
        **CONFIG, **change, "is_active": True,
    })
    assert rejected.status_code == 400
    assert rejected.json["error"]["code"] == "configuration_invalid"
    current = admin.get(BASE).json["integration"]
    assert current["provider_name"] == "ViaCEP"
    assert current["url_template"] == CONFIG["url_template"]
    assert current["is_active"] is True


def test_lookup_reports_identifiable_error_when_integration_is_disabled(app, monkeypatch):
    from app import cep_integration

    with app.app_context():
        db.session.add(CepIntegration(**CONFIG, is_active=False))
        db.session.commit()
    monkeypatch.setattr(cep_integration, "_https_get", lambda *args: pytest.fail("não deve consultar"))

    response = client_as(app, "lookup").get(BASE + "/lookup?cep=01001000")
    assert response.status_code == 409
    assert response.json["error"]["code"] == "integration_disabled"
    assert response.json["error"]["message"] == "Consulta de CEP está desativada."
