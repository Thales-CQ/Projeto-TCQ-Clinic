#!/usr/bin/env python3
"""Reset only the ADMIN application login in the isolated validation database."""

from __future__ import annotations

import getpass
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from werkzeug.security import generate_password_hash


DATABASE = "clinica_validacao"
EXPECTED_USER = "clinica_teste@localhost"
EXPECTED_REVISION = "f3a4b5c6d7e8"
REQUIRED_PERMISSIONS = {
    "patients.view", "patients.create", "patients.update",
}


def main() -> int:
    db_password = getpass.getpass(
        "Senha MySQL de clinica_teste (entrada apenas em memória): "
    )
    new_password = getpass.getpass(
        "Nova senha da conta de aplicação ADMIN em clinica_validacao: "
    )
    if len(new_password) < 12:
        print("A senha precisa ter pelo menos 12 caracteres.", file=sys.stderr)
        return 2
    if new_password != getpass.getpass("Confirme a nova senha: "):
        print("As senhas não coincidem; nenhuma alteração feita.", file=sys.stderr)
        return 2

    url = URL.create(
        "mysql+pymysql", username="clinica_teste", password=db_password,
        host="127.0.0.1", database=DATABASE,
    )
    engine = create_engine(url, hide_parameters=True, pool_pre_ping=True)
    try:
        with engine.begin() as connection:
            database, current_user, revision = connection.execute(text(
                "SELECT DATABASE(), CURRENT_USER(), "
                "(SELECT version_num FROM alembic_version)"
            )).one()
            if (database, current_user, revision) != (
                DATABASE, EXPECTED_USER, EXPECTED_REVISION
            ):
                raise RuntimeError(
                    "Destino recusado: banco, conta MySQL ou revisão inesperados."
                )

            user = connection.execute(text(
                "SELECT id, is_active, is_admin FROM users WHERE username = 'ADMIN'"
            )).one_or_none()
            if user is None or not user.is_active or not user.is_admin:
                raise RuntimeError("A conta ADMIN ativa não foi encontrada.")

            permissions = set(connection.execute(text(
                "SELECT DISTINCT p.code FROM permissions p "
                "JOIN profile_permissions pp ON pp.permission_id = p.id "
                "JOIN user_profiles up ON up.profile_id = pp.profile_id "
                "JOIN profiles pr ON pr.id = up.profile_id "
                "WHERE up.user_id = :user_id AND pr.is_active = 1"
            ), {"user_id": user.id}).scalars())
            missing = REQUIRED_PERMISSIONS - permissions
            if missing:
                raise RuntimeError(
                    "ADMIN não possui todas as permissões necessárias: "
                    + ", ".join(sorted(missing))
                )

            connection.execute(text(
                "UPDATE users SET password_hash = :password_hash WHERE id = :user_id"
            ), {
                "password_hash": generate_password_hash(new_password),
                "user_id": user.id,
            })
        print(
            "Senha da conta de aplicação ADMIN redefinida somente em "
            "clinica_validacao; permissões verificadas."
        )
        return 0
    except Exception as exc:
        print(f"Nenhuma redefinição concluída: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
