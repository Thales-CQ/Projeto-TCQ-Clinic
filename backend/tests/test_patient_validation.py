from copy import deepcopy
from datetime import date, timedelta

import pytest

from app.validators.patient import (
    validate_email, validate_full_name, validate_patient,
    validate_postal_code, validate_state,
)


VALID_REQUIRED_FIELDS = {"birth_date": "1990-05-20", "sex": "F"}


@pytest.mark.parametrize(
    "value, expected",
    [
        ("maria silva", "MARIA SILVA"),
        ("MaRiA SiLvA", "MARIA SILVA"),
        ("  Maria Silva \t\n", "MARIA SILVA"),
    ],
)
def test_validate_full_name_normalizes_to_uppercase(value, expected):
    assert validate_full_name(value) == expected


@pytest.mark.parametrize(
    "value, expected",
    [("Maria Silva", "MARIA SILVA"), ("João da Silva", "JOÃO DA SILVA")],
)
def test_accepts_full_name_with_two_or_more_parts(value, expected):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": value})

    assert errors == {}
    assert normalized["full_name"] == expected


@pytest.mark.parametrize("value", ["Maria", "Ana"])
def test_rejects_full_name_with_only_one_part(value):
    normalized, errors = validate_patient(
        {**VALID_REQUIRED_FIELDS, "full_name": value}
    )

    assert "full_name" in errors
    assert "full_name" not in normalized


def test_accepts_multiple_name_parts_and_normalizes_to_uppercase():
    normalized, errors = validate_patient(
        {**VALID_REQUIRED_FIELDS, "full_name": "  maria beatriz costa  "}
    )

    assert errors == {}
    assert normalized["full_name"] == "MARIA BEATRIZ COSTA"


@pytest.mark.parametrize(
    "value, expected",
    [
        ("1134567890", "1134567890"),
        ("11987654321", "11987654321"),
        ("(11) 3456-7890", "1134567890"),
        ("(11) 98765-4321", "11987654321"),
    ],
)
def test_phone_accepts_ten_or_eleven_digits_and_normalizes(value, expected):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "phone": value})

    assert errors == {}
    assert normalized["phone"] == expected


@pytest.mark.parametrize(
    "value",
    ["1198765432a", "11987654321@", "11/98765-4321", "123456789", "123456789012"],
)
def test_phone_rejects_invalid_characters_or_digit_count(value):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "phone": value})

    assert "phone" in errors
    assert "phone" not in normalized


@pytest.mark.parametrize(
    "value, expected",
    [
        ("ANA@EXAMPLE.COM", "ana@example.com"),
        ("Ana.Souza@Example.Com.Br", "ana.souza@example.com.br"),
        ("  Ana@Example.com \t\n", "ana@example.com"),
    ],
)
def test_validate_email_normalizes_to_lowercase(value, expected):
    assert validate_email(value) == expected


def test_normalizes_patient_without_mutating_input():
    payload = {
        "full_name": "  Maria Silva  ",
        "birth_date": " 1990-05-20 ",
        "sex": "f",
        "cpf": " 529.982.247-25 ",
        "phone": " 11987654321 ",
        "email": " maria@example.com ",
    }
    original = deepcopy(payload)

    normalized, errors = validate_patient(payload)

    assert errors == {}
    assert normalized == {
        "full_name": "MARIA SILVA",
        "birth_date": date(1990, 5, 20),
        "sex": "F",
        "cpf": "52998224725",
        "phone": "11987654321",
        "email": "maria@example.com",
    }
    assert payload == original
    assert normalized is not payload


def test_omitted_optional_fields_remain_absent():
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva"})

    assert errors == {}
    assert normalized == {
        "full_name": "MARIA SILVA",
        "birth_date": date(1990, 5, 20),
        "sex": "F",
    }


@pytest.mark.parametrize("value", ["01001-000", "01001000", " 01001-000 "])
def test_postal_code_accepts_cep_and_normalizes_to_eight_digits(value):
    assert validate_postal_code(value) == "01001000"


@pytest.mark.parametrize("value", ["0100-100", "0100100", "01001-00A", 1001000])
def test_postal_code_rejects_invalid_cep(value):
    with pytest.raises(ValueError):
        validate_postal_code(value)


@pytest.mark.parametrize("value, expected", [("sp", "SP"), (" AC ", "AC")])
def test_state_normalizes_valid_uf(value, expected):
    assert validate_state(value) == expected


@pytest.mark.parametrize("value", ["XX", "S", "SPX"])
def test_state_rejects_invalid_uf(value):
    with pytest.raises(ValueError):
        validate_state(value)


@pytest.mark.parametrize("field", ["postal_code", "address", "address_number", "city", "state"])
@pytest.mark.parametrize("empty", [None, "", "  "])
def test_empty_address_fields_are_explicit_clear_values(field, empty):
    normalized, errors = validate_patient({field: empty}, partial=True)
    assert errors == {}
    assert normalized == {field: None}


def test_omitted_address_fields_remain_absent_in_partial_update():
    normalized, errors = validate_patient({"city": "Campinas"}, partial=True)
    assert errors == {}
    assert normalized == {"city": "Campinas"}


@pytest.mark.parametrize("field", ["cpf", "phone", "email"])
@pytest.mark.parametrize("empty", [None, "", " \t\n "])
@pytest.mark.parametrize("partial", [False, True])
def test_empty_optional_fields_become_none(field, empty, partial):
    payload = {**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", field: empty}
    original = deepcopy(payload)

    normalized, errors = validate_patient(payload, partial=partial)

    assert errors == {}
    assert normalized[field] is None
    assert payload == original


def test_full_name_is_required_on_creation():
    normalized, errors = validate_patient({})

    assert normalized == {}
    assert "full_name" in errors


def test_partial_update_preserves_omitted_fields():
    normalized, errors = validate_patient({}, partial=True)

    assert normalized == {}
    assert errors == {}


@pytest.mark.parametrize("partial", [False, True])
@pytest.mark.parametrize("value", [None, "", "   ", 123, False, [], {}, "a" * 151])
def test_rejects_invalid_full_name(value, partial):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": value}, partial=partial)

    assert "full_name" in errors
    assert "full_name" not in normalized


def test_full_name_length_is_checked_after_trimming():
    name = "a" * 148 + " b"
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "  " + name + "  "})

    assert errors == {}
    assert normalized["full_name"] == "A" * 148 + " B"


@pytest.mark.parametrize("value", ["2000-02-29", date(2000, 2, 29)])
def test_accepts_valid_birth_date(value):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "birth_date": value})

    assert errors == {}
    assert normalized["birth_date"] == date(2000, 2, 29)


def test_accepts_today_as_birth_date():
    today = date.today()
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "birth_date": today})

    assert errors == {}
    assert normalized["birth_date"] == today


@pytest.mark.parametrize("value", ["2023-02-29", "2000-13-01", "20/05/1990", "1990-5-2"])
def test_rejects_invalid_birth_date(value):
    _, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "birth_date": value})

    assert "birth_date" in errors


def test_rejects_future_birth_date():
    tomorrow = date.today() + timedelta(days=1)
    _, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "birth_date": tomorrow.isoformat()})

    assert "birth_date" in errors


@pytest.mark.parametrize("value", ["52998224725", "529.982.247-25", "012.345.678-90"])
def test_accepts_valid_cpf_and_preserves_leading_zero(value):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "cpf": value})

    assert errors == {}
    assert normalized["cpf"] == value.replace(".", "").replace("-", "")


@pytest.mark.parametrize(
    "value",
    ["52998224715", "52998224724", "5299822472", "529982247255", "abc52998224725", "...-"],
)
def test_rejects_invalid_cpf(value):
    _, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "cpf": value})

    assert "cpf" in errors


@pytest.mark.parametrize("digit", "0123456789")
def test_rejects_cpf_with_repeated_digits(digit):
    _, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "cpf": digit * 11})

    assert "cpf" in errors


@pytest.mark.parametrize("value", ["ana@example.com", "ana.souza+tag@example.com.br"])
def test_accepts_basic_email(value):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "email": value})

    assert errors == {}
    assert normalized["email"] == value


@pytest.mark.parametrize(
    "value",
    [
        "ana",
        "ana@",
        "@example.com",
        "ana@example",
        "a@@example.com",
        "a b@example.com",
    ],
)
def test_rejects_invalid_email(value):
    _, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", "email": value})

    assert "email" in errors


@pytest.mark.parametrize("field", ["cpf", "phone", "email"])
@pytest.mark.parametrize("value", [123, False, [], {}])
def test_rejects_non_text_optional_input(field, value):
    _, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", field: value})

    assert field in errors


@pytest.mark.parametrize(
    "field, value",
    [("email", "a" * 242 + "@example.com")],
)
def test_accepts_text_at_storage_limit(field, value):
    normalized, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", field: value})

    assert errors == {}
    assert normalized[field] == value


@pytest.mark.parametrize(
    "field, value",
    [("phone", "1" * 21), ("email", "a" * 243 + "@example.com")],
)
def test_rejects_text_above_storage_limit(field, value):
    _, errors = validate_patient({**VALID_REQUIRED_FIELDS, "full_name": "Maria Silva", field: value})

    assert field in errors


def test_invalid_input_is_not_mutated_and_errors_are_collected():
    payload = {**VALID_REQUIRED_FIELDS, "full_name": "   ", "cpf": "111.111.111-11", "email": "invalid"}
    original = deepcopy(payload)

    _, errors = validate_patient(payload)

    assert set(errors) == {"full_name", "cpf", "email"}
    assert payload == original


@pytest.mark.parametrize("field", ["birth_date", "sex"])
def test_required_fields_are_required_on_creation(field):
    payload = {"full_name": "Maria Silva", **VALID_REQUIRED_FIELDS}
    del payload[field]

    normalized, errors = validate_patient(payload)

    assert set(errors) == {field}
    assert field not in normalized


@pytest.mark.parametrize("partial", [False, True])
@pytest.mark.parametrize("value", [None, "", " \t\n ", 123, False, [], {}])
def test_rejects_empty_or_invalid_type_birth_date(value, partial):
    payload = {"full_name": "Maria Silva", **VALID_REQUIRED_FIELDS, "birth_date": value}

    normalized, errors = validate_patient(payload, partial=partial)

    assert set(errors) == {"birth_date"}
    assert "birth_date" not in normalized


@pytest.mark.parametrize("value, expected", [("M", "M"), ("m", "M"), ("F", "F"), ("f", "F")])
def test_sex_accepts_and_normalizes_m_or_f(value, expected):
    payload = {"full_name": "Maria Silva", **VALID_REQUIRED_FIELDS, "sex": value}

    normalized, errors = validate_patient(payload)

    assert errors == {}
    assert normalized["sex"] == expected


@pytest.mark.parametrize("partial", [False, True])
@pytest.mark.parametrize("value", [None, "", " \t\n ", 123, False, [], {}, "X", "MF", "Masculino", "Feminino"])
def test_rejects_invalid_sex(value, partial):
    payload = {"full_name": "Maria Silva", **VALID_REQUIRED_FIELDS, "sex": value}

    normalized, errors = validate_patient(payload, partial=partial)

    assert set(errors) == {"sex"}
    assert "sex" not in normalized
