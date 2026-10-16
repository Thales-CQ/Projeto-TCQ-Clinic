import pytest
from flask_migrate import upgrade
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app import create_app
from app.config import Config
from app.extensions import db
from app.models import CepIntegration, Permission, Profile, User


EXPECTED_CODES = {
    "patients.view", "patients.create", "patients.update", "patients.change_status",
    "users.view", "users.create", "users.update", "users.change_status",
    "users.reset_password", "users.assign_profiles",
    "profiles.view", "profiles.create", "profiles.update",
    "integrations.cep.view", "integrations.cep.configure",
    "integrations.cep.manage", "integrations.cep.lookup",
}


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setattr(Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'permissions.db'}")
    monkeypatch.setattr(Config, "SECRET_KEY", "permissions-test-secret")
    app = create_app()
    app.config["TESTING"] = True
    yield app
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_permission_models_and_many_to_many_constraints(app):
    with app.app_context():
        db.create_all()
        inspector = inspect(db.engine)
        assert {"permissions", "profile_permissions", "user_profiles"} <= set(
            inspector.get_table_names()
        )
        assert {column["name"] for column in inspector.get_columns("permissions")} == {
            "id", "code", "description",
        }
        assert set(inspector.get_pk_constraint("profile_permissions")["constrained_columns"]) == {
            "profile_id", "permission_id",
        }
        assert {tuple(fk["constrained_columns"]) for fk in inspector.get_foreign_keys(
            "profile_permissions"
        )} == {("profile_id",), ("permission_id",)}

        first = Profile(name="Equipe")
        second = Profile(name="Clínica")
        view = Permission(code="patients.view", description="Consultar pacientes")
        create = Permission(code="patients.create", description="Cadastrar pacientes")
        first.permissions.extend((view, create))
        second.permissions.append(view)
        user = User(username="operator")
        user.set_password("test-password-123")
        user.profiles.extend((first, second))
        db.session.add(user)
        db.session.commit()
        db.session.expire_all()

        assert {permission.code for permission in first.permissions} == {
            "patients.view", "patients.create",
        }
        assert {profile.name for profile in view.profiles} == {"Equipe", "Clínica"}
        assert {profile.name for profile in user.profiles} == {"Equipe", "Clínica"}
        assert {linked.username for linked in first.users} == {"OPERATOR"}

        db.session.add(Permission(code="patients.view", description="Duplicada"))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_migration_seeds_only_administrator_and_preserves_existing_links(app):
    with app.app_context():
        upgrade(revision="f6c6d75d8e20")
        admin = Profile.query.filter_by(name="Administrador").one()
        common = Profile(name="Equipe")
        user = User(username="existing", is_admin=False)
        user.set_password("test-password-123")
        user.profiles.append(common)
        db.session.add(user)
        db.session.commit()
        admin_id, common_id, user_id = admin.id, common.id, user.id

        upgrade()
        db.session.expire_all()
        assert {permission.code for permission in Permission.query.all()} == EXPECTED_CODES
        assert Permission.query.count() == len(EXPECTED_CODES)
        assert {permission.code for permission in db.session.get(Profile, admin_id).permissions} == EXPECTED_CODES
        assert db.session.get(Profile, common_id).permissions == []
        assert [profile.id for profile in db.session.get(User, user_id).profiles] == [common_id]
        assert db.session.get(User, user_id).is_admin is False
        integration = CepIntegration.query.one()
        assert integration.provider_name == "ViaCEP"
        assert integration.url_template == "https://viacep.com.br/ws/{cep}/json/"
        assert integration.method == "GET"
        assert integration.field_map == {
            "cep": "cep", "address": "logradouro",
            "city": "localidade", "state": "uf",
        }
        assert integration.credential_ciphertext is None
        assert db.session.execute(text(
            "SELECT COUNT(*) FROM profile_permissions WHERE profile_id = :profile_id"
        ), {"profile_id": admin_id}).scalar_one() == len(EXPECTED_CODES)
