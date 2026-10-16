import pytest
from flask_migrate import upgrade

from app import create_app
from app.admin_profile import sync_admin_profile
from app.config import Config
from app.extensions import db
from app.models import Permission, Profile, User


BASE = "/api/v1/profiles"


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setattr(Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'profiles-api.db'}")
    monkeypatch.setattr(Config, "SECRET_KEY", "profiles-api-secret")
    monkeypatch.setattr(Config, "SESSION_COOKIE_SECURE", False)
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        upgrade()
        admin = User(username="admin", is_admin=True)
        common = User(username="common")
        for user in (admin, common):
            user.set_password("test-password-123")
            db.session.add(user)
        db.session.flush()
        sync_admin_profile(admin)
        db.session.commit()
    yield app
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def as_user(app, user_id):
    client = app.test_client()
    if user_id is not None:
        with client.session_transaction() as session:
            session["user_id"] = user_id
    return client


def write(client, method, path, payload):
    token = client.get("/api/v1/auth/me").json["csrf_token"]
    return getattr(client, method)(path, json=payload, headers={
        "X-CSRF-Token": token, "Origin": "http://localhost",
    })


@pytest.mark.parametrize("method,path", [
    ("get", BASE), ("get", BASE + "/1"), ("get", BASE + "/permissions"),
    ("post", BASE), ("patch", BASE + "/1"),
])
@pytest.mark.parametrize("identity,status", [(None, 401), (2, 403)])
def test_authentication_and_missing_permission(app, method, path, identity, status):
    client = as_user(app, identity)
    response = (client.get(path) if method == "get"
                else write(client, method, path, {"name": "Teste"}))
    assert response.status_code == status
    assert response.headers["Cache-Control"] == "no-store"


def test_list_get_create_and_edit(app):
    client = as_user(app, 1)
    initial = client.get(BASE)
    assert initial.status_code == 200
    assert [(profile["name"], profile["is_active"]) for profile in initial.json["profiles"]] == [
        ("Administrador", True)]
    assert set(initial.json["profiles"][0]) == {
        "id", "name", "is_active", "created_at", "permission_ids",
    }
    assert initial.json["profiles"][0]["permission_ids"] == sorted(catalog_ids(app).values())
    assert client.get(BASE + "/1").json["profile"]["permission_ids"] == sorted(catalog_ids(app).values())
    assert "password_hash" not in initial.get_data(as_text=True)
    assert client.get(BASE + "/999").status_code == 404

    created = write(client, "post", BASE, {"name": "  Equipe   Clínica  ", "is_active": False})
    assert created.status_code == 201
    profile = created.json["profile"]
    assert profile["name"] == "Equipe Clínica" and profile["is_active"] is False
    assert profile["permission_ids"] == []
    assert client.get(f"{BASE}/{profile['id']}").json["profile"] == profile
    assert len(client.get(BASE).json["profiles"]) == 2

    activated = write(client, "patch", f"{BASE}/{profile['id']}", {"is_active": True})
    assert activated.status_code == 200
    assert activated.json["profile"]["is_active"] is True
    changed = write(client, "patch", f"{BASE}/{profile['id']}", {"name": "  Outra   Equipe "})
    assert changed.status_code == 200
    assert changed.json["profile"]["name"] == "Outra Equipe"
    assert write(client, "patch", f"{BASE}/{profile['id']}", {"is_active": False}).status_code == 200
    assert client.get(f"{BASE}/{profile['id']}").json["profile"]["is_active"] is False


@pytest.mark.parametrize("payload", [{}, {"name": ""}, {"name": "  \t  "}, {"name": None},
                                     {"is_active": True}, {"name": "Ok", "is_active": "false"},
                                     {"name": "Ok", "password_hash": "secret"}])
def test_invalid_creation(app, payload):
    response = write(as_user(app, 1), "post", BASE, payload)
    assert response.status_code == 400
    with app.app_context():
        assert Profile.query.count() == 1


def test_duplicates_and_missing_profile(app):
    client = as_user(app, 1)
    assert write(client, "post", BASE, {"name": "  administrador "}).status_code == 409
    first = write(client, "post", BASE, {"name": "Equipe  Azul"})
    assert first.status_code == 201
    assert write(client, "post", BASE, {"name": " equipe azul "}).status_code == 409
    other = write(client, "post", BASE, {"name": "Outro"})
    assert write(client, "patch", f"{BASE}/{other.json['profile']['id']}",
                 {"name": " EQUIPE   AZUL "}).status_code == 409
    assert write(client, "patch", BASE + "/999", {"name": "Novo"}).status_code == 404
    assert write(client, "patch", f"{BASE}/{first.json['profile']['id']}",
                 {"name": "   "}).status_code == 400


def test_structural_admin_cannot_be_renamed_or_deactivated(app):
    client = as_user(app, 1)
    admin_id = client.get(BASE).json["profiles"][0]["id"]
    for payload in ({"name": "Outro Nome"}, {"name": " ADMINISTRADOR "},
                    {"is_active": False}, {"name": "Outro Nome", "is_active": False}):
        assert write(client, "patch", f"{BASE}/{admin_id}", payload).status_code == 409
    assert write(client, "patch", f"{BASE}/{admin_id}", {"is_active": True}).status_code == 200
    with app.app_context():
        admin = db.session.get(Profile, admin_id)
        assert admin.name == "Administrador" and admin.is_active is True
        assert db.session.get(User, 1).is_admin is True


@pytest.mark.parametrize("identity", [1, 2])
def test_csrf_required_for_profile_writes(app, identity):
    with app.app_context():
        common = db.session.get(User, 2)
        common.profiles.append(Profile(
            name="Operador", permissions=Permission.query.all(),
        ))
        db.session.commit()
    client = as_user(app, identity)
    assert client.post(BASE, json={"name": "Novo", "permission_ids": []}).status_code == 403
    assert client.patch(BASE + "/1", json={"permission_ids": []}).status_code == 403


@pytest.mark.parametrize("code,method,path,payload,status", [
    ("profiles.view", "get", BASE, None, 200),
    ("profiles.view", "get", BASE + "/permissions", None, 200),
    ("profiles.view", "get", BASE + "/1", None, 200),
    ("profiles.create", "post", BASE, {"name": "Equipe"}, 201),
    ("profiles.update", "patch", BASE + "/1", {"is_active": True}, 200),
])
def test_individual_profile_permissions_grant_access(
    app, code, method, path, payload, status,
):
    with app.app_context():
        permission = Permission.query.filter_by(code=code).one()
        common = db.session.get(User, 2)
        common.profiles.append(Profile(name="Operador", permissions=[permission]))
        db.session.commit()
    client = as_user(app, 2)
    response = client.get(path) if method == "get" else write(client, method, path, payload)
    assert response.status_code == status


@pytest.mark.parametrize("code,method,path,payload", [
    ("profiles.view", "get", BASE, None),
    ("profiles.view", "get", BASE + "/permissions", None),
    ("profiles.view", "get", BASE + "/1", None),
    ("profiles.create", "post", BASE, {"name": "Equipe"}),
    ("profiles.update", "patch", BASE + "/1", {"is_active": True}),
])
@pytest.mark.parametrize("is_admin", [False, True])
def test_missing_specific_permission_is_denied(app, code, method, path, payload, is_admin):
    with app.app_context():
        admin_profile = Profile.query.filter_by(name="Administrador").one()
        admin_profile.permissions.remove(Permission.query.filter_by(code=code).one())
        db.session.get(User, 1).is_admin = is_admin
        db.session.commit()
    client = as_user(app, 1)
    response = client.get(path) if method == "get" else write(client, method, path, payload)
    assert response.status_code == 403


@pytest.mark.parametrize("method,path", [
    ("get", BASE), ("get", BASE + "/1"), ("get", BASE + "/permissions"),
    ("post", BASE), ("patch", BASE + "/1"),
])
def test_inactive_user_with_permissions_is_denied(app, method, path):
    client = as_user(app, 1)
    token = client.get("/api/v1/auth/me").json["csrf_token"]
    with app.app_context():
        db.session.get(User, 1).is_active = False
        db.session.commit()
    response = client.open(path, method=method.upper(), json={"name": "Equipe", "permission_ids": []}, headers={
        "X-CSRF-Token": token, "Origin": "http://localhost",
    })
    assert response.status_code == 401



def test_inactive_user_and_structural_profile_protection_with_permissions(app):
    with app.app_context():
        common = db.session.get(User, 2)
        common.profiles.append(Profile(name="Operador", permissions=[
            Permission.query.filter_by(code="profiles.update").one()
        ]))
        db.session.commit()
    client = as_user(app, 2)
    assert write(client, "patch", BASE + "/1", {"name": "Outro Nome"}).status_code == 409
    assert write(client, "patch", BASE + "/1", {"is_active": False}).status_code == 409
    with app.app_context():
        db.session.get(User, 2).is_active = False
        db.session.commit()
    assert client.get(BASE).status_code == 401
    assert write(client, "patch", BASE + "/1", {"is_active": True}).status_code == 401


def catalog_ids(app):
    with app.app_context():
        return {permission.code: permission.id for permission in Permission.query.all()}


def profile_state(app, profile_id):
    with app.app_context():
        profile = db.session.get(Profile, profile_id)
        return (profile.name, profile.is_active, {p.id for p in profile.permissions})


def test_catalog_contains_exact_migrated_permissions(app):
    expected = {
        "patients.view", "patients.create", "patients.update", "patients.change_status",
        "users.view", "users.create", "users.update", "users.change_status",
        "users.reset_password", "users.assign_profiles",
        "profiles.view", "profiles.create", "profiles.update",
        "integrations.cep.view", "integrations.cep.configure",
        "integrations.cep.manage", "integrations.cep.lookup",
    }
    response = as_user(app, 1).get(BASE + "/permissions")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    rows = response.json["permissions"]
    assert len(rows) == len(expected)
    assert {row["code"] for row in rows} == expected
    assert [row["code"] for row in rows] == sorted(expected)
    with app.app_context():
        assert rows == [
            {"id": p.id, "code": p.code, "description": p.description}
            for p in Permission.query.order_by(Permission.code).all()
        ]


def test_create_replace_preserve_and_clear_permissions(app):
    ids = catalog_ids(app)
    client = as_user(app, 1)
    created = write(client, "post", BASE, {
        "name": "Equipe", "permission_ids": [ids["patients.view"], ids["patients.create"]],
    })
    assert created.status_code == 201
    assert created.json["profile"]["permission_ids"] == sorted(
        [ids["patients.view"], ids["patients.create"]]
    )
    profile_id = created.json["profile"]["id"]
    path = f"{BASE}/{profile_id}"
    assert profile_state(app, profile_id)[2] == {ids["patients.view"], ids["patients.create"]}
    replaced = write(client, "patch", path, {"permission_ids": [ids["users.view"]]})
    assert replaced.status_code == 200
    assert replaced.json["profile"]["permission_ids"] == [ids["users.view"]]
    assert profile_state(app, profile_id)[2] == {ids["users.view"]}
    assert write(client, "patch", path, {"name": "Renomeado", "is_active": False}).status_code == 200
    assert profile_state(app, profile_id) == ("Renomeado", False, {ids["users.view"]})
    cleared = write(client, "patch", path, {"permission_ids": []})
    assert cleared.status_code == 200
    assert cleared.json["profile"]["permission_ids"] == []
    assert profile_state(app, profile_id)[2] == set()
    for extra in ({}, {"permission_ids": []}):
        response = write(client, "post", BASE, {"name": f"Vazio {len(extra)}", **extra})
        assert response.status_code == 201
        assert profile_state(app, response.json["profile"]["id"])[2] == set()


@pytest.mark.parametrize("value", [None, True, 1, "1", {}, [True], [False], [0], [-1],
                                       [1.0], ["1"], [[1]], [1, 1], [999999], [1, 999999], [10**100]])
@pytest.mark.parametrize("method", ["post", "patch"])
def test_invalid_permission_ids_are_atomic(app, value, method):
    client = as_user(app, 1)
    created = write(client, "post", BASE, {"name": "Equipe", "permission_ids": [1]})
    profile_id = created.json["profile"]["id"]
    before = profile_state(app, profile_id)
    path = BASE if method == "post" else f"{BASE}/{profile_id}"
    response = write(client, method, path, {
        "name": "Alterado", "is_active": False, "permission_ids": value,
    })
    assert response.status_code == 400
    assert profile_state(app, profile_id) == before
    with app.app_context():
        assert Profile.query.count() == 2


@pytest.mark.parametrize("is_admin", [False, True])
@pytest.mark.parametrize("method", ["post", "patch"])
@pytest.mark.parametrize("keep_existing", [False, True])
def test_cannot_grant_or_retain_permissions_outside_actor_limit(app, is_admin, method, keep_existing):
    ids = catalog_ids(app)
    with app.app_context():
        actor = db.session.get(User, 2)
        actor.is_admin = is_admin
        actor.profiles.append(Profile(name="Operador", permissions=Permission.query.filter(
            Permission.code.in_(["profiles.create", "profiles.update", "patients.view"])
        ).all()))
        actor.profiles.append(Profile(name="Inativo", is_active=False, permissions=[
            db.session.get(Permission, ids["users.reset_password"]),
        ]))
        target = Profile(name="Alvo", permissions=[
            db.session.get(Permission, ids["users.reset_password"])
        ] if keep_existing else [])
        db.session.add(target)
        db.session.commit()
        target_id = target.id
        count = Profile.query.count()
    before = profile_state(app, target_id)
    path = BASE if method == "post" else f"{BASE}/{target_id}"
    response = write(as_user(app, 2), method, path, {
        "name": "Alterado", "is_active": False,
        "permission_ids": [ids["patients.view"], ids["users.reset_password"]],
    })
    assert response.status_code == 403
    assert profile_state(app, target_id) == before
    with app.app_context():
        assert Profile.query.count() == count


def test_nonadmin_can_grant_own_permissions_and_omit_higher_existing_permissions(app):
    ids = catalog_ids(app)
    with app.app_context():
        actor = db.session.get(User, 2)
        actor.profiles.append(Profile(name="Operador", permissions=Permission.query.filter(
            Permission.code.in_(["profiles.create", "profiles.update", "patients.view"])
        ).all()))
        target = Profile(name="Alvo", permissions=[db.session.get(Permission, ids["users.view"])])
        db.session.add(target)
        db.session.commit()
        target_id = target.id
    client = as_user(app, 2)
    response = write(client, "post", BASE, {"name": "Novo", "permission_ids": [ids["patients.view"]]})
    assert response.status_code == 201
    assert profile_state(app, response.json["profile"]["id"])[2] == {ids["patients.view"]}
    assert write(client, "patch", f"{BASE}/{target_id}", {"name": "Renomeado"}).status_code == 200
    assert profile_state(app, target_id)[2] == {ids["users.view"]}
    assert write(client, "patch", f"{BASE}/{target_id}", {
        "permission_ids": [ids["patients.view"]],
    }).status_code == 200
    assert profile_state(app, target_id)[2] == {ids["patients.view"]}


@pytest.mark.parametrize("removed", [None, *range(17)])
def test_administrator_cannot_lose_any_structural_permission(app, removed):
    ids = sorted(catalog_ids(app).values())
    requested = [] if removed is None else ids[:removed] + ids[removed + 1:]
    before = profile_state(app, 1)
    response = write(as_user(app, 1), "patch", BASE + "/1", {"permission_ids": requested})
    assert response.status_code == 409
    assert profile_state(app, 1) == before


def test_administrator_full_set_and_duplicate_post_preserve_structure(app):
    client = as_user(app, 1)
    ids = list(catalog_ids(app).values())
    assert write(client, "patch", BASE + "/1", {"permission_ids": ids[::-1]}).status_code == 200
    for values in ([], ids):
        assert write(client, "post", BASE, {
            "name": " administrador ", "permission_ids": values,
        }).status_code == 409
    assert profile_state(app, 1) == ("Administrador", True, set(ids))


@pytest.mark.parametrize("method", ["post", "patch"])
def test_grant_is_rechecked_after_write_lock(app, monkeypatch, method):
    from sqlalchemy import delete
    from app import user_api
    from app.models.profile import profile_permissions

    ids = catalog_ids(app)
    with app.app_context():
        target = Profile(name="Alvo")
        db.session.add(target)
        db.session.commit()
        target_id = target.id
    original_lock = user_api.lock_user_writes

    def revoke_before_lock():
        with db.engine.begin() as connection:
            connection.execute(delete(profile_permissions).where(
                profile_permissions.c.profile_id == 1,
                profile_permissions.c.permission_id == ids["patients.view"],
            ))
        original_lock()

    monkeypatch.setattr(user_api, "lock_user_writes", revoke_before_lock)
    path = BASE if method == "post" else f"{BASE}/{target_id}"
    assert write(as_user(app, 1), method, path, {
        "name": "Alterado", "permission_ids": [ids["patients.view"]],
    }).status_code == 403
    assert profile_state(app, target_id) == ("Alvo", True, set())
    with app.app_context():
        assert Profile.query.count() == 2


def test_permission_changes_apply_to_existing_session(app):
    ids = catalog_ids(app)
    with app.app_context():
        common = db.session.get(User, 2)
        profile = Profile(name="Equipe")
        common.profiles.append(profile)
        db.session.commit()
        profile_id = profile.id
    common_client = as_user(app, 2)
    admin_client = as_user(app, 1)
    assert common_client.get("/api/v1/patients").status_code == 403
    assert write(admin_client, "patch", f"{BASE}/{profile_id}", {
        "permission_ids": [ids["patients.view"]],
    }).status_code == 200
    assert common_client.get("/api/v1/patients").status_code == 200
    assert write(admin_client, "patch", f"{BASE}/{profile_id}", {"permission_ids": []}).status_code == 200
    assert common_client.get("/api/v1/patients").status_code == 403


def test_commit_failure_rolls_back_profile_and_permission_changes(app, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    ids = catalog_ids(app)
    client = as_user(app, 1)
    created = write(client, "post", BASE, {"name": "Equipe", "permission_ids": [ids["patients.view"]]})
    profile_id = created.json["profile"]["id"]
    before = profile_state(app, profile_id)

    def fail_commit():
        db.session.flush()
        raise IntegrityError("simulated", {}, Exception("simulated"))

    monkeypatch.setattr(db.session, "commit", fail_commit)
    assert write(client, "patch", f"{BASE}/{profile_id}", {
        "name": "Alterado", "is_active": False, "permission_ids": [ids["users.view"]],
    }).status_code == 409
    assert profile_state(app, profile_id) == before
    assert write(client, "post", BASE, {
        "name": "Novo", "permission_ids": [ids["users.view"]],
    }).status_code == 409
    with app.app_context():
        assert Profile.query.count() == 2
