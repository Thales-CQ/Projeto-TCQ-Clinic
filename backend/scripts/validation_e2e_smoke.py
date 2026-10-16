#!/usr/bin/env python3
"""Exercise the real Vite -> Flask -> MySQL patient flow with fake data.

This test intentionally leaves one clearly named fictitious patient in
clinica_validacao. It is opt-in because record numbers are permanent.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import getpass
import http.cookiejar
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener


DEFAULT_FRONTEND = "http://127.0.0.1:5173"


class ValidationFlow:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/")
        self.origin = self.base_url
        self.cookies = http.cookiejar.CookieJar()
        self.http = build_opener(HTTPCookieProcessor(self.cookies))
        self.csrf_token = None

    def request(self, path, *, method="GET", payload=None, expect=(200,)):
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if method in {"POST", "PUT", "PATCH", "DELETE"}:
            headers["Origin"] = self.origin
            if self.csrf_token:
                headers["X-CSRF-Token"] = self.csrf_token
        req = Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with self.http.open(req, timeout=10) as response:
                status = response.status
                body = response.read()
        except HTTPError as exc:
            status = exc.code
            body = exc.read()
        except URLError as exc:
            raise RuntimeError(f"Não foi possível acessar {self.base_url}: {exc.reason}") from exc
        try:
            result = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Resposta não JSON em {path} (HTTP {status}).") from exc
        if isinstance(result, dict) and isinstance(result.get("csrf_token"), str):
            self.csrf_token = result["csrf_token"]
        if status not in expect:
            message = result.get("error", "resposta inesperada") if isinstance(result, dict) else "resposta inesperada"
            raise RuntimeError(f"{method} {path}: HTTP {status}: {message}")
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_FRONTEND)
    parser.add_argument(
        "--write", action="store_true",
        help="permite criar um paciente sintético persistente e consumir um prontuário",
    )
    args = parser.parse_args()
    if not args.write:
        print("Nenhuma chamada de escrita feita. Use --write somente com autorização.")
        return 2
    if input("Para criar um paciente fictício em clinica_validacao, digite E2E clinica_validacao: ") != "E2E clinica_validacao":
        print("Cancelado; nenhuma chamada de escrita feita.")
        return 2

    username = input("Usuário de validação com permissões de pacientes: ").strip()
    password = getpass.getpass("Senha (entrada apenas em memória): ")
    flow = ValidationFlow(args.base_url)

    try:
        flow.request("/api/v1/health")
        flow.request("/api/v1/auth/me", expect=(401,))
        if not flow.csrf_token:
            raise RuntimeError("API não forneceu token CSRF inicial.")
        flow.request(
            "/api/v1/auth/login",
            method="POST",
            payload={"username": username, "password": password},
        )
        session = flow.request("/api/v1/auth/me")
        permissions = set(session["user"].get("permissions", []))
        required = {"patients.view", "patients.create", "patients.update"}
        if not required <= permissions:
            raise RuntimeError(
                "A conta autenticada não tem as permissões de consulta, cadastro e edição."
            )

        marker = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        fake_name = f"TESTE FICTICIO INTEGRACAO {marker}"
        created = flow.request(
            "/api/v1/patients",
            method="POST",
            payload={
                "full_name": fake_name,
                "birth_date": "1990-01-02",
                "sex": "F",
                "cpf": None,
                "phone": None,
                "email": None,
                "postal_code": "01001000",
                "address": "Rua Fictícia de Integração",
                "address_number": "123",
                "city": "Cidade de Teste",
                "state": "SP",
            },
            expect=(201,),
        )
        patient = created["patient"]
        patient_id = patient["id"]
        record_number = patient["record_number"]
        if patient["full_name"] != fake_name or not record_number:
            raise RuntimeError("Resposta de cadastro não confirmou o paciente sintético.")

        fetched = flow.request(f"/api/v1/patients/{patient_id}")["patient"]
        if fetched["record_number"] != record_number or fetched["address"] != "Rua Fictícia de Integração":
            raise RuntimeError("Consulta não recuperou os dados persistidos do cadastro.")

        edited_address = "Avenida Fictícia de Integração"
        flow.request(
            f"/api/v1/patients/{patient_id}",
            method="PATCH",
            payload={"address": edited_address},
        )
        persisted = flow.request(f"/api/v1/patients/{patient_id}")["patient"]
        if persisted["address"] != edited_address or persisted["record_number"] != record_number:
            raise RuntimeError("Edição não persistiu ou alterou o prontuário.")

        print(
            "PASSOU: Vite proxy -> Flask -> MySQL; paciente fictício criado, "
            f"consultado, editado e relido (id={patient_id}, prontuário={record_number})."
        )
        print("O paciente de teste permanece em clinica_validacao e seu prontuário não será reutilizado.")
        return 0
    except Exception as exc:
        print(f"FALHOU: {exc}", file=sys.stderr)
        print(
            "Se o cadastro chegou a responder HTTP 201, confira o paciente sintético antes "
            "de repetir; ele pode ter permanecido no banco.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
