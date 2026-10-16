#!/usr/bin/env python3
"""Supervised replacement of the 39 synthetic patients in clinica_validacao.

No database writes occur unless --apply is supplied. Connections use only the
mysql_config_editor login path; this script never reads the application's .env.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time
import uuid


LOGIN_PATH = "clinica-validacao"
DATABASE = "clinica_validacao"
MYSQL_USER = "clinica_teste@localhost"
EXPECTED_IDS = list(range(1, 40))
ADDRESS_COLUMNS = ("postal_code", "address", "address_number", "city", "state")
CORE_COLUMNS = ("full_name", "birth_date", "sex", "cpf", "phone", "email")

NAMES = [
    "ALICE NUVEM DE TESTE", "BRUNO CAMPO FICTICIO", "CLARA JARDIM IMAGINARIO",
    "DAVI RIO DE DADOS", "ELISA PONTE DE PAPEL", "FABIO VALE SINTETICO",
    "GAIA SOL DE ENSAIO", "HEITOR LAGO DE EXEMPLO", "INES MAPA INVENTADO",
    "JOAO BOSQUE DE TESTE", "LARA ESTRELA FICTICIA", "MATEUS RUA IMAGINARIA",
    "NINA HORIZONTE DE DADOS", "OTAVIO MONTE SINTETICO", "PAULA TRILHA DE ENSAIO",
    "RAUL JARDIM DE EXEMPLO", "SARA NUVEM INVENTADA", "TIAGO CAMPO DE TESTE",
    "UNA PONTE FICTICIA", "VITOR VALE DE DADOS", "YARA SOL IMAGINARIO",
    "ZOE LAGO SINTETICO", "AMORA MAPA DE ENSAIO", "BENTO BOSQUE DE EXEMPLO",
    "CECILIA RIO INVENTADO", "DANTE ESTRELA DE TESTE", "ESTER MONTE FICTICIO",
    "FELIPE TRILHA DE DADOS", "HELENA HORIZONTE SINTETICO", "IGOR RUA DE ENSAIO",
    "JULIA JARDIM DE EXEMPLO", "KAI NUVEM INVENTADA", "LUISA CAMPO FICTICIO",
    "MIGUEL PONTE DE DADOS", "NOEMI VALE IMAGINARIO", "OSCAR SOL DE TESTE",
    "RENATA LAGO FICTICIO", "SAMUEL MAPA SINTETICO", "TERESA BOSQUE DE ENSAIO",
]

UFS = ("SP", "RJ", "MG", "PR", "BA", "RS", "PE", "CE", "GO", "SC")


def cpf_with_check_digits(base: int) -> str:
    digits = f"{base:09d}"
    for length in (9, 10):
        total = sum(int(digits[i]) * (length + 1 - i) for i in range(length))
        digit = (total * 10 % 11) % 10
        digits += str(digit)
    return digits


def make_patients() -> list[dict[str, object]]:
    patients = []
    for i, name in enumerate(NAMES, start=1):
        birth_year = 1958 + ((i * 7) % 43)
        birth_month = ((i - 1) % 12) + 1
        birth_day = ((i * 3) % 27) + 1
        patients.append({
            "id": i,
            "full_name": name,
            "birth_date": dt.date(birth_year, birth_month, birth_day).isoformat(),
            "sex": "F" if i % 2 else "M",
            # Checksum-valid values from a high synthetic test range. These are
            # fictional test identifiers and must not be used outside validation.
            "cpf": cpf_with_check_digits(999_999_900 + i - 1),
            "phone": f"00000000{i:02d}",
            "email": f"paciente{i:03d}@example.invalid",
            "postal_code": f"00000{i:03d}",
            "address": f"Rua Ficticia de Validacao, Quadra {i:02d}",
            "address_number": f"{i:02d}",
            "city": f"Municipio de Teste {i:02d}",
            "state": UFS[(i - 1) % len(UFS)],
        })
    return patients


PATIENTS = make_patients()


def sql_quote(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''").replace("\0", "\\0") + "'"


def cpf_valid(value: str) -> bool:
    if len(value) != 11 or len(set(value)) == 1 or not value.isdigit():
        return False
    for length in (9, 10):
        total = sum(int(value[i]) * (length + 1 - i) for i in range(length))
        if int(value[length]) != (total * 10 % 11) % 10:
            return False
    return True


class MysqlSession:
    def __init__(self) -> None:
        command = [
            "mysql", f"--login-path={LOGIN_PATH}", f"--database={DATABASE}",
            "--batch", "--skip-column-names", "--raw", "--unbuffered",
        ]
        self.proc = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, bufsize=0,
        )
        self.selector = selectors.DefaultSelector()
        assert self.proc.stdout is not None
        self.selector.register(self.proc.stdout, selectors.EVENT_READ)
        self.buffer = b""
        self.query("SELECT DATABASE(), CURRENT_USER()")

    def query(self, statement: str) -> list[str]:
        assert self.proc.stdin is not None
        marker = "__END_" + uuid.uuid4().hex + "__"
        payload = (statement.rstrip().rstrip(";") + ";\nSELECT " + sql_quote(marker) + ";\n").encode()
        self.proc.stdin.write(payload)
        self.proc.stdin.flush()
        lines: list[str] = []
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if b"\n" in self.buffer:
                raw, self.buffer = self.buffer.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").rstrip("\r")
                if line == marker:
                    return lines
                if line.startswith("ERROR ") or line.startswith("mysql:"):
                    raise RuntimeError(line)
                if line:
                    lines.append(line)
                continue
            remaining = deadline - time.monotonic()
            if not self.selector.select(remaining):
                break
            chunk = os.read(self.proc.stdout.fileno(), 4096)
            if not chunk:
                break
            self.buffer += chunk
        raise RuntimeError("Timeout ou encerramento inesperado da conexão mysql.")

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.query("QUIT")
            except Exception:
                pass
        if self.proc.stdin:
            self.proc.stdin.close()
        self.proc.wait(timeout=10)
        self.selector.close()


def get_columns(db: MysqlSession) -> list[str]:
    rows = db.query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
        f"WHERE TABLE_SCHEMA={sql_quote(DATABASE)} AND TABLE_NAME='patients' "
        "ORDER BY ORDINAL_POSITION"
    )
    return rows


def get_snapshot(db: MysqlSession, columns: list[str]) -> list[dict[str, object]]:
    allowed = set(columns)
    keys = ["id", *[c for c in (
        "full_name", "birth_date", "cpf", "phone", "email", "is_active",
        "created_at", "updated_at", "sex", "record_number", *ADDRESS_COLUMNS,
    ) if c in allowed]]
    pairs = ", ".join(f"'{key}', `{key}`" for key in keys)
    hex_rows = db.query(
        f"SELECT HEX(CAST(JSON_OBJECT({pairs}) AS CHAR)) FROM patients ORDER BY id"
    )
    try:
        return [json.loads(bytes.fromhex(line).decode("utf-8")) for line in hex_rows]
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Não foi possível ler o snapshot dos pacientes.") from exc


def check_connection(db: MysqlSession) -> None:
    result = db.query("SELECT DATABASE(), CURRENT_USER()")
    if result != [f"{DATABASE}\t{MYSQL_USER}"]:
        raise RuntimeError(f"Conexão recusada: esperado {DATABASE} / {MYSQL_USER}; recebido {result!r}.")


def validate_proposal() -> None:
    if len(PATIENTS) != 39 or [p["id"] for p in PATIENTS] != EXPECTED_IDS:
        raise RuntimeError("A proposta não contém exatamente os IDs de 1 a 39.")
    for patient in PATIENTS:
        if len(str(patient["full_name"])) > 150 or len(str(patient["email"])) > 254:
            raise RuntimeError("Nome ou e-mail excede os limites da tabela.")
        if len(str(patient["phone"])) not in (10, 11) or len(str(patient["cpf"])) != 11:
            raise RuntimeError("Telefone ou CPF não atende ao formato esperado.")
        if not cpf_valid(str(patient["cpf"])):
            raise RuntimeError(f"CPF de teste inválido para o ID {patient['id']}.")
        date = dt.date.fromisoformat(str(patient["birth_date"]))
        if date > dt.date.today() or patient["sex"] not in ("M", "F"):
            raise RuntimeError(f"Data ou sexo inválido para o ID {patient['id']}.")
        if len(str(patient["postal_code"])) != 8 or not str(patient["postal_code"]).isdigit():
            raise RuntimeError(f"CEP inválido para o ID {patient['id']}.")
        if len(str(patient["address"])) > 255 or len(str(patient["address_number"])) > 20:
            raise RuntimeError(f"Endereço excede o limite para o ID {patient['id']}.")
        if len(str(patient["city"])) > 120 or len(str(patient["state"])) != 2:
            raise RuntimeError(f"Cidade ou UF inválida para o ID {patient['id']}.")
    if len({p["cpf"] for p in PATIENTS}) != 39 or len({p["email"] for p in PATIENTS}) != 39:
        raise RuntimeError("A proposta contém CPF ou e-mail repetido.")


def write_backup(rows: list[dict[str, object]]) -> Path:
    directory = Path(os.environ.get("TMPDIR", "/tmp")) / "clinica-validation-patient-backups"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    path = directory / f"patients-before-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{os.getpid()}.json"
    content = json.dumps(rows, ensure_ascii=False, indent=2) + "\n"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    return path


def canonical_row(row: dict[str, object]) -> str:
    return json.dumps(row, ensure_ascii=False, sort_keys=True, default=str)


def verify_expected(rows: list[dict[str, object]], include_addresses: bool) -> None:
    if [row.get("id") for row in rows] != EXPECTED_IDS:
        raise RuntimeError("IDs ou quantidade divergiram: esperados IDs 1..39.")
    expected_fields = (*CORE_COLUMNS, *(ADDRESS_COLUMNS if include_addresses else ()))
    by_id = {int(row["id"]): row for row in rows}
    for patient in PATIENTS:
        actual = by_id[patient["id"]]
        for field in expected_fields:
            if str(actual.get(field)) != str(patient[field]):
                raise RuntimeError(f"Conferência falhou no ID {patient['id']}, campo {field}.")


def apply_changes(db: MysqlSession, columns: list[str], snapshot: list[dict[str, object]]) -> Path:
    missing_addresses = sorted(set(ADDRESS_COLUMNS) - set(columns))
    if missing_addresses:
        raise RuntimeError(
            "Aplicação cancelada sem alterações: faltam colunas de endereço "
            + ", ".join(missing_addresses)
            + ". Os endereços estão preparados no script; aguarde essas colunas existirem."
        )
    if len(snapshot) != 39 or [row.get("id") for row in snapshot] != EXPECTED_IDS:
        raise RuntimeError("Aplicação cancelada: patients não contém exatamente IDs 1..39.")
    proposed_cpf_owner = {str(patient["cpf"]): int(patient["id"]) for patient in PATIENTS}
    cpf_conflicts = [
        (str(row.get("cpf")), int(row["id"]), proposed_cpf_owner[str(row["cpf"])])
        for row in snapshot
        if row.get("cpf") is not None
        and str(row["cpf"]) in proposed_cpf_owner
        and proposed_cpf_owner[str(row["cpf"])] != int(row["id"])
    ]
    if cpf_conflicts:
        raise RuntimeError(
            "Aplicação cancelada: há CPFs propostos que colidem com outro registro atual. "
            f"IDs envolvidos: {cpf_conflicts!r}"
        )

    backup = write_backup(snapshot)
    try:
        db.query("START TRANSACTION")
        locked = db.query("SELECT id FROM patients ORDER BY id FOR UPDATE")
        if locked != [str(i) for i in EXPECTED_IDS]:
            raise RuntimeError("IDs mudaram após o backup; transação cancelada.")
        current = get_snapshot(db, columns)
        if [canonical_row(x) for x in current] != [canonical_row(x) for x in snapshot]:
            raise RuntimeError("Registros mudaram após o backup; transação cancelada.")

        fields = (*CORE_COLUMNS, *ADDRESS_COLUMNS)
        for patient in PATIENTS:
            assignments = ", ".join(f"`{field}`={sql_quote(patient[field])}" for field in fields)
            statement = f"UPDATE patients SET {assignments}, `updated_at`=CURRENT_TIMESTAMP WHERE id={patient['id']}"
            db.query(statement)

        updated = get_snapshot(db, columns)
        verify_expected(updated, include_addresses=True)
        for before, after in zip(snapshot, updated):
            if before.get("record_number") != after.get("record_number"):
                raise RuntimeError("record_number mudou; transação cancelada.")
        db.query("COMMIT")
    except Exception:
        try:
            db.query("ROLLBACK")
        except Exception:
            pass
        raise

    after_commit = get_snapshot(db, columns)
    verify_expected(after_commit, include_addresses=True)
    if [row.get("id") for row in after_commit] != EXPECTED_IDS:
        raise RuntimeError("Conferência pós-commit: quantidade ou IDs divergiram.")
    for before, after in zip(snapshot, after_commit):
        if before.get("record_number") != after.get("record_number"):
            raise RuntimeError("Conferência pós-commit: record_number foi alterado.")
    return backup


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="aplica a substituição supervisionada")
    args = parser.parse_args()
    validate_proposal()
    db = MysqlSession()
    try:
        check_connection(db)
        columns = get_columns(db)
        snapshot = get_snapshot(db, columns)
        if args.apply:
            backup = apply_changes(db, columns, snapshot)
            print(f"Substituição concluída: 39 registros atualizados; IDs e record_number preservados.")
            print(f"Backup anterior protegido: {backup}")
        else:
            print(f"Conexão validada: {DATABASE} / {MYSQL_USER}")
            print(f"Pacientes atuais: {len(snapshot)}; IDs: {[row.get('id') for row in snapshot]}")
            missing = sorted(set(ADDRESS_COLUMNS) - set(columns))
            print("Colunas de endereço ausentes: " + (", ".join(missing) if missing else "nenhuma"))
            print("Modo somente leitura. Use --apply apenas após autorização explícita.")
            print("id | nome | nascimento | sexo | cpf de teste | telefone | e-mail | CEP | logradouro | número | cidade | UF")
            for p in PATIENTS:
                print(" | ".join(str(p[k]) for k in (
                    "id", "full_name", "birth_date", "sex", "cpf", "phone", "email",
                    "postal_code", "address", "address_number", "city", "state",
                )))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(1)
