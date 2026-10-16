"""Patient input validation independent of HTTP and database access."""

import re
from datetime import date, datetime


def _optional_text(value, field, max_length):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} deve ser texto.")
    value = value.strip()
    if not value:
        return None
    if len(value) > max_length:
        raise ValueError(f"{field} deve ter no máximo {max_length} caracteres.")
    return value


def validate_full_name(value):
    value = _optional_text(value, "full_name", 150)
    if value is None:
        raise ValueError("full_name é obrigatório.")
    if len(value.split()) < 2:
        raise ValueError("Informe o nome completo, com pelo menos nome e sobrenome.")
    return value.upper()


def validate_birth_date(value):
    if value is None:
        raise ValueError("birth_date é obrigatória.")
    if isinstance(value, str):
        value = value.strip()
        if not value:
            raise ValueError("birth_date é obrigatória.")
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("birth_date deve estar no formato YYYY-MM-DD.")
        try:
            value = date.fromisoformat(value)
        except ValueError:
            raise ValueError("birth_date deve ser uma data válida.") from None
    if not isinstance(value, date) or isinstance(value, datetime):
        raise ValueError("birth_date deve ser uma data válida.")
    if value > date.today():
        raise ValueError("birth_date não pode ser futura.")
    return value


def validate_sex(value):
    if value is None:
        raise ValueError("sex é obrigatório.")
    if not isinstance(value, str):
        raise ValueError("sex deve ser texto.")
    value = value.strip().upper()
    if not value:
        raise ValueError("sex é obrigatório.")
    if value not in ("M", "F"):
        raise ValueError("sex deve ser M ou F.")
    return value


def validate_cpf(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("cpf deve ser texto.")
    value = value.strip()
    if not value:
        return None
    if not re.fullmatch(r"[0-9.\-\s]+", value):
        raise ValueError("cpf contém caracteres inválidos.")
    value = re.sub(r"[^0-9]", "", value)
    if len(value) != 11 or len(set(value)) == 1:
        raise ValueError("cpf inválido.")
    for length in (9, 10):
        total = sum(int(value[i]) * (length + 1 - i) for i in range(length))
        digit = (total * 10 % 11) % 10
        if int(value[length]) != digit:
            raise ValueError("cpf inválido.")
    return value


def validate_phone(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("phone deve ser texto.")
    value = value.strip()
    if not value:
        return None
    if not re.fullmatch(r"[0-9\s()\-]+", value):
        raise ValueError("phone contém caracteres inválidos.")
    value = re.sub(r"[^0-9]", "", value)
    if len(value) not in (10, 11):
        raise ValueError("phone deve ter 10 ou 11 dígitos.")
    return value


def validate_email(value):
    value = _optional_text(value, "email", 254)
    if value is not None:
        value = value.lower()
    if value is not None and not re.fullmatch(
        r"[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+", value
    ):
        raise ValueError("email inválido.")
    return value


BRAZILIAN_STATES = frozenset({
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
    "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
    "RR", "SC", "SP", "SE", "TO",
})


def validate_postal_code(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("postal_code deve ser texto.")
    value = value.strip()
    if not value:
        return None
    if not re.fullmatch(r"[0-9]{5}-?[0-9]{3}", value):
        raise ValueError("postal_code deve conter 8 dígitos.")
    return value.replace("-", "")


def validate_state(value):
    value = _optional_text(value, "state", 2)
    if value is None:
        return None
    value = value.upper()
    if value not in BRAZILIAN_STATES:
        raise ValueError("state deve ser uma UF brasileira válida.")
    return value


PATIENT_VALIDATORS = {
    "full_name": validate_full_name,
    "birth_date": validate_birth_date,
    "sex": validate_sex,
    "cpf": validate_cpf,
    "phone": validate_phone,
    "email": validate_email,
    "postal_code": validate_postal_code,
    "address": lambda value: _optional_text(value, "address", 255),
    "address_number": lambda value: _optional_text(value, "address_number", 20),
    "city": lambda value: _optional_text(value, "city", 120),
    "state": validate_state,
}


def validate_patient(data, *, partial=False):
    """Return (normalized fields, field errors) without modifying input.

    Omitted fields remain absent. full_name, birth_date and sex are required
    unless partial=True; explicitly empty required fields are always invalid.
    Empty optional fields become
    None. Only supported fields are returned, and invalid fields are excluded.
    Callers must reject input whenever errors is nonempty. Non-dictionary input
    raises ValueError.
    """
    if not isinstance(data, dict):
        raise ValueError("Os dados do paciente devem ser um dicionário.")

    normalized = {}
    errors = {}
    if not partial and "full_name" not in data:
        errors["full_name"] = "full_name é obrigatório."
    if not partial and "birth_date" not in data:
        errors["birth_date"] = "birth_date é obrigatória."
    if not partial and "sex" not in data:
        errors["sex"] = "sex é obrigatório."

    for field, validator in PATIENT_VALIDATORS.items():
        if field not in data:
            continue
        try:
            normalized[field] = validator(data[field])
        except ValueError as exc:
            errors[field] = str(exc)
    return normalized, errors
