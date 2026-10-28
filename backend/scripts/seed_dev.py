#!/usr/bin/env python3
"""Create the SQLite schema and seed a development admin user + permissions."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import create_app
from app.extensions import db
from app.models import Permission, Profile, User
from app.admin_profile import sync_admin_profile


PERMISSIONS_CATALOG = (
    ("patients.view", "Consultar pacientes"),
    ("patients.create", "Cadastrar pacientes"),
    ("patients.update", "Alterar pacientes"),
    ("patients.change_status", "Alterar status de pacientes"),
    ("users.view", "Consultar usuários"),
    ("users.create", "Cadastrar usuários"),
    ("users.update", "Alterar usuários"),
    ("users.change_status", "Alterar status de usuários"),
    ("users.reset_password", "Redefinir senha de usuários"),
    ("users.assign_profiles", "Atribuir perfis a usuários"),
    ("profiles.view", "Consultar perfis"),
    ("profiles.create", "Cadastrar perfis"),
    ("profiles.update", "Alterar perfis"),
    ("integrations.cep.view", "Consultar configuração da integração de CEP"),
    ("integrations.cep.configure", "Configurar provedor de CEP"),
    ("integrations.cep.manage", "Gerenciar credencial do provedor de CEP"),
    ("integrations.cep.lookup", "Consultar CEP"),
)


def main():
    app = create_app()
    with app.app_context():
        db.create_all()

        existing = User.query.filter_by(username="ADMIN").first()
        if existing is not None:
            print("Admin user already exists. Skipping seed.")
            return

        permissions = []
        for code, description in PERMISSIONS_CATALOG:
            perm = Permission.query.filter_by(code=code).first()
            if perm is None:
                perm = Permission(code=code, description=description)
                db.session.add(perm)
            permissions.append(perm)

        admin_profile = Profile.query.filter_by(name="Administrador").first()
        if admin_profile is None:
            admin_profile = Profile(name="Administrador")
            db.session.add(admin_profile)
            db.session.flush()
        admin_profile.permissions = permissions

        user = User(
            full_name="ADMIN DESENVOLVIMENTO",
            email="admin@dev.local",
            username="ADMIN",
            is_active=True,
            is_admin=True,
        )
        user.set_password("Admin@123456")
        db.session.add(user)
        sync_admin_profile(user)
        db.session.commit()

        print("Seed concluído com sucesso.")
        print("  Usuario: ADMIN")
        print("  Senha:   Admin@123456")
        print("  Permissoes atribuidas ao perfil Administrador:", len(permissions))


if __name__ == "__main__":
    main()
