from flask import Flask

from .commands import complete_legacy_user, create_admin, normalize_users
from .config import Config
from .database_safety import install_validation_database_guard
from .extensions import db, migrate
from .models import User
from .routes import register_routes


def create_app():
    """Cria e configura a aplicação Flask."""

    app = Flask(__name__)
    app.config.from_object(Config)

    # Inicializa as extensões da aplicação.
    db.init_app(app)
    migrate.init_app(app, db)

    if app.config.get("VALIDATION_DATABASE_GUARD"):
        with app.app_context():
            install_validation_database_guard(
                db.engine,
                expected_database=app.config["VALIDATION_EXPECTED_DATABASE"],
                expected_user=app.config["VALIDATION_EXPECTED_USER"],
            )

    # Registra as rotas HTTP da API.
    register_routes(app)

    # Registra os comandos administrativos do Flask CLI.
    app.cli.add_command(create_admin)
    app.cli.add_command(complete_legacy_user)
    app.cli.add_command(normalize_users)

    return app
