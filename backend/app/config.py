import os
from datetime import timedelta

from dotenv import load_dotenv


VALIDATION_MODE = os.getenv("TCQ_VALIDATION_MODE") == "1"

# The validation launcher supplies every value it needs before importing the
# app. Do not load backend/.env in that mode, where it may contain a different
# database URL or production secrets.
if not VALIDATION_MODE:
    load_dotenv()


class Config:
    SQLALCHEMY_ENGINE_OPTIONS = {"hide_parameters": True}
    MAX_CONTENT_LENGTH = 64 * 1024  # 64 KiB
    SECRET_KEY = os.getenv("SECRET_KEY")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = (
        os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
    )
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=30)
    CEP_PROVIDER_ALLOWED_HOSTS = tuple(
        host.strip().lower()
        for host in os.getenv("CEP_PROVIDER_ALLOWED_HOSTS", "viacep.com.br").split(",")
        if host.strip()
    )
    CEP_CREDENTIAL_ENCRYPTION_KEYS = tuple(
        key.strip()
        for key in os.getenv("CEP_CREDENTIAL_ENCRYPTION_KEYS", "").split(":")
        if key.strip()
    )
    CEP_PROVIDER_TIMEOUT_SECONDS = 3
    VALIDATION_MODE = VALIDATION_MODE
    VALIDATION_DATABASE_GUARD = VALIDATION_MODE
    VALIDATION_EXPECTED_DATABASE = os.getenv(
        "TCQ_VALIDATION_EXPECTED_DATABASE", "clinica_validacao"
    )
    VALIDATION_EXPECTED_USER = os.getenv(
        "TCQ_VALIDATION_EXPECTED_USER", "clinica_teste@localhost"
    )
