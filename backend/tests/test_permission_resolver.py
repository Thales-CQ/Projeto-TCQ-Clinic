import pytest
from flask import jsonify
from flask_migrate import upgrade

from app import create_app
from app.config import Config
from app.extensions import db
from app.models import Permission, Profile, User
from app.permission_security import effective_permissions, has_permission, require_permission


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setattr(Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'resolver.db'}")
    monkeypatch.setattr(Config, "SECRET_KEY", "resolver-test-secret")
    monkeypatch.setattr(Config, "SESSION_COOKIE_SECURE", False)
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        upgrade()
        user = User(username="operator", is_admin=True)
        user.set_password("test-password-123")
        db.session.add(user)
        db.session.commit()

    @app.route("/api/v1/test/permission", methods=["GET", "POST"])
    @require_permission("patients.view")
    def permission_view():
        return jsonify({"allowed": True})

    yield app
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_effective_permissions_union_duplicates_and_inactive_profiles(app):
    with app.app_context():
        user = User.query.filter_by(username="OPERATOR").one()
        view = Permission.query.filter_by(code="patients.view").one()
        create = Permission.query.filter_by(code="patients.create").one()
        users_view = Permission.query.filter_by(code="users.view").one()
        first = Profile(name="Equipe", permissions=[view, create])
        second = Profile(name="Recepção", permissions=[view])
        inactive = Profile(name="Antigo", is_active=False, permissions=[users_view])
        db.session.add_all([first, second, inactive])
        user.profiles.extend([first, second, inactive])
        db.session.commit()

        assert effective_permissions(user) == {"patients.view", "patients.create"}
        assert has_permission(user, "patients.view")
        assert not has_permission(user, "users.view")

        first.is_active = False
        second.is_active = False
        db.session.commit()
        assert effective_permissions(user) == set()


def test_administrator_grants_come_from_migration(app):
    with app.app_context():
        user = User.query.filter_by(username="OPERATOR").one()
        assert effective_permissions(user) == set()  # is_admin grants nothing by itself
        admin = Profile.query.filter_by(name="Administrador").one()
        user.profiles.append(admin)
        db.session.commit()
        assert len(effective_permissions(user)) == 17
        assert effective_permissions(user) == {permission.code for permission in Permission.query.all()}


def test_decorator_authentication_permission_and_live_changes(app):
    client = app.test_client()
    assert client.get("/api/v1/test/permission").status_code == 401
    with app.app_context():
        user = User.query.filter_by(username="OPERATOR").one()
        user_id = user.id
    with client.session_transaction() as session:
        session["user_id"] = user_id

    assert client.get("/api/v1/test/permission").status_code == 403
    with app.app_context():
        user = db.session.get(User, user_id)
        profile = Profile(name="Clínica", permissions=[Permission.query.filter_by(code="patients.view").one()])
        db.session.add(profile)
        user.profiles.append(profile)
        db.session.commit()
        profile_id = profile.id
    assert client.get("/api/v1/test/permission").json == {"allowed": True}

    with app.app_context():
        profile = db.session.get(Profile, profile_id)
        profile.permissions.clear()
        db.session.commit()
    assert client.get("/api/v1/test/permission").status_code == 403

    with app.app_context():
        profile = db.session.get(Profile, profile_id)
        profile.permissions.append(Permission.query.filter_by(code="patients.view").one())
        db.session.commit()
    assert client.get("/api/v1/test/permission").status_code == 200

    with app.app_context():
        db.session.get(Profile, profile_id).is_active = False
        db.session.commit()
    assert client.get("/api/v1/test/permission").status_code == 403

    with app.app_context():
        db.session.get(User, user_id).is_active = False
        db.session.commit()
    assert client.get("/api/v1/test/permission").status_code == 401


def test_decorator_keeps_csrf_for_writes(app):
    client = app.test_client()
    with app.app_context():
        user = User.query.filter_by(username="OPERATOR").one()
        user.profiles.append(Profile.query.filter_by(name="Administrador").one())
        db.session.commit()
        user_id = user.id
    with client.session_transaction() as session:
        session["user_id"] = user_id
    assert client.post("/api/v1/test/permission").status_code == 403
    token = client.get("/api/v1/auth/me").json["csrf_token"]
    assert client.post("/api/v1/test/permission", headers={"X-CSRF-Token": token}).status_code == 200
