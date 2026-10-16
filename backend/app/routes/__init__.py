from .auth import auth_bp
from .health import health_bp
from .patients import patients_bp
from .users import users_bp
from .profiles import profiles_bp
from .integrations import integrations_bp


def register_routes(app):
    app.register_blueprint(health_bp, url_prefix="/api/v1")
    app.register_blueprint(auth_bp, url_prefix="/api/v1/auth")
    app.register_blueprint(patients_bp, url_prefix="/api/v1/patients")
    app.register_blueprint(users_bp, url_prefix="/api/v1/users")
    app.register_blueprint(profiles_bp, url_prefix="/api/v1/profiles")
    app.register_blueprint(integrations_bp, url_prefix="/api/v1/integrations")
