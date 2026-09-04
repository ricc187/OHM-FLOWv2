"""Exploration script for the Volta ERP API (myvolta.ch) — READ ONLY.

Isolated one-off script, NOT wired into the Flask app (no import from
backend/, no new route). Purpose: authenticate against the real Volta v3
API and pull the handful of endpoints relevant to a project ("chantier"),
so their JSON shape can be compared against our `chantier_financier`
model. See VOLTA_API_NOTES.md at the repo root for the resulting mapping.

STRICT RATE LIMIT: the provider recommends max ~10 requests/hour on this
business API (this does NOT apply to the public /api-docs spec endpoint).
This script therefore:
  - makes ONE HTTP call per explicit function call (no loops, no retries,
    no polling, no pagination-follow),
  - is meant to be driven step-by-step from an interactive session (or by
    calling `main()` once), never re-run in a tight loop,
  - logs a timestamp for every single business-API request it makes so
    the total count for the session can be audited afterwards.

Credentials come exclusively from .env at the repo root (python-dotenv).
Never hardcode them here, never print them, never commit scripts/volta_dumps/
(gitignored) — those JSON dumps contain real client data.
"""
from __future__ import annotations

import datetime
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
DUMPS_DIR = Path(__file__).resolve().parent / "volta_dumps"
DUMPS_DIR.mkdir(exist_ok=True)

load_dotenv(REPO_ROOT / ".env")

BASE_URL = os.environ["VOLTA_API_BASE_URL"].rstrip("/")
USERNAME = os.environ["VOLTA_USERNAME"]
PASSWORD = os.environ["VOLTA_PASSWORD"]
CLIENT_ACCOUNT_CODE = os.environ["VOLTA_CLIENT_ACCOUNT_CODE"]
ORG_UNIT_PROJECTS = os.environ["VOLTA_ORG_UNIT_PROJECTS"]  # ATE-ATE-1
ORG_UNIT_ADDRESSES = os.environ["VOLTA_ORG_UNIT_ADDRESSES"]  # ATE-ATE

# Confirmed against the real OpenAPI v3 spec fetched from
# https://app.myvolta.ch/volta-api/v3/api-docs (fetching that spec itself is
# NOT rate-limited — it's the public docs endpoint, not the business API).
AUTH_URL = f"{BASE_URL}/authenticate"
PROJECTS_URL = f"{BASE_URL}/v2/projects"
OFFERS_URL = f"{BASE_URL}/v2/offers"
CONTRACTS_URL = f"{BASE_URL}/v2/contracts"
REPORTS_URL = f"{BASE_URL}/v2/reports"


def _log_call(label: str) -> None:
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    print(f"[{ts}] BUSINESS-API CALL -> {label}", file=sys.stderr)


def _dump(name: str, payload) -> Path:
    path = DUMPS_DIR / f"{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  saved {path}")
    return path


def authenticate() -> str:
    """POST /authenticate — 1 business-API call.

    Body confirmed against components.schemas.LoginRequest in the v3 spec:
    {username, password, clientAccountCode}. Response is LoginResponse:
    {access_token, user_id, client_account_code, employee_key}.
    """
    _log_call("POST /authenticate")
    resp = requests.post(
        AUTH_URL,
        json={
            "username": USERNAME,
            "password": PASSWORD,
            "clientAccountCode": CLIENT_ACCOUNT_CODE,
        },
        timeout=30,
    )
    print(f"  status={resp.status_code}")
    data = resp.json()
    _dump("00_authenticate_response", {k: v for k, v in data.items() if k != "access_token"} | {
        "access_token": "***REDACTED-IN-DUMP***"
    })
    resp.raise_for_status()
    token = data["access_token"]
    if not token:
        raise RuntimeError("No access_token in login response")
    return token


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def list_projects(token: str) -> list[dict]:
    """GET /v2/projects?orgUnitCode=... — 1 business-API call.

    No free-text filter is offered by this endpoint (only
    modifiedAfter/projectMainNumber/subNumber/externalProjectId) so we pull
    the org unit's project list and filter client-side for "La Baita" by
    mainTitle/subTitle.
    """
    _log_call(f"GET /v2/projects?orgUnitCode={ORG_UNIT_PROJECTS}")
    resp = requests.get(
        PROJECTS_URL,
        headers=_auth_headers(token),
        params={"orgUnitCode": ORG_UNIT_PROJECTS},
        timeout=30,
    )
    print(f"  status={resp.status_code}")
    resp.raise_for_status()
    data = resp.json()
    _dump("01_projects", data)
    print(f"  {len(data)} project(s) returned")
    return data


def find_la_baita(projects: list[dict]) -> dict | None:
    needle = "baita"
    for p in projects:
        haystack = f"{p.get('mainTitle', '')} {p.get('subTitle', '')}".lower()
        if needle in haystack:
            return p
    return None


def list_offers(token: str, main_number: int, sub_number: int) -> list[dict]:
    """GET /v2/offers — 1 business-API call. modifiedAfter is required by the
    spec; we pass an old date to effectively get everything for that project.
    """
    _log_call(f"GET /v2/offers (project {main_number}/{sub_number})")
    resp = requests.get(
        OFFERS_URL,
        headers=_auth_headers(token),
        params={
            "orgUnitCode": ORG_UNIT_PROJECTS,
            "modifiedAfter": "2000-01-01T00:00:00",
            "projectMainNumber": main_number,
            "projectSubNumber": sub_number,
        },
        timeout=30,
    )
    print(f"  status={resp.status_code}")
    resp.raise_for_status()
    data = resp.json()
    _dump("02_offers", data)
    print(f"  {len(data)} offer(s) returned")
    return data


def list_contracts(token: str, main_number: int, sub_number: int) -> list[dict]:
    """GET /v2/contracts — 1 business-API call."""
    _log_call(f"GET /v2/contracts (project {main_number}/{sub_number})")
    resp = requests.get(
        CONTRACTS_URL,
        headers=_auth_headers(token),
        params={
            "orgUnitCode": ORG_UNIT_PROJECTS,
            "modifiedAfter": "2000-01-01T00:00:00",
            "projectMainNumber": main_number,
            "projectSubNumber": sub_number,
        },
        timeout=30,
    )
    print(f"  status={resp.status_code}")
    resp.raise_for_status()
    data = resp.json()
    _dump("03_contracts", data)
    print(f"  {len(data)} contract(s) returned")
    return data


def list_reports(token: str) -> list[dict]:
    """GET /v2/reports?orgUnitCode=... — 1 business-API call.

    No project filter is offered on this endpoint in the v3 spec (only
    orgUnitCode/modifiedAfter/reportTypes) so we pull the org unit's reports
    and filter client-side on the project number if needed.
    """
    _log_call(f"GET /v2/reports?orgUnitCode={ORG_UNIT_PROJECTS}")
    resp = requests.get(
        REPORTS_URL,
        headers=_auth_headers(token),
        params={"orgUnitCode": ORG_UNIT_PROJECTS},
        timeout=30,
    )
    print(f"  status={resp.status_code}")
    resp.raise_for_status()
    data = resp.json()
    _dump("04_reports", data)
    print(f"  {len(data)} report(s) returned")
    return data


if __name__ == "__main__":
    # Deliberately driven one step at a time from the shell, spaced out
    # manually between invocations — see module docstring on the rate
    # limit. Each `step` bundles the minimum number of business-API calls
    # needed to make progress; it never loops or retries on its own.
    step = sys.argv[1] if len(sys.argv) > 1 else "projects"

    if step == "projects":
        # 2 business-API calls: authenticate + list projects for the org unit.
        tok = authenticate()
        projects = list_projects(tok)
        hit = find_la_baita(projects)
        print("La Baita match:", json.dumps(hit, ensure_ascii=False, indent=2) if hit else None)

    elif step == "financials":
        # 4 business-API calls: authenticate + offers + contracts + reports,
        # for one already-known project (mainNumber/subNumber from the
        # "projects" step above). Usage:
        #   python explore_volta_api.py financials <mainNumber> <subNumber>
        if len(sys.argv) != 4:
            print("Usage: python explore_volta_api.py financials <mainNumber> <subNumber>", file=sys.stderr)
            sys.exit(1)
        main_number, sub_number = int(sys.argv[2]), int(sys.argv[3])
        tok = authenticate()
        list_offers(tok, main_number, sub_number)
        list_contracts(tok, main_number, sub_number)
        list_reports(tok)

    else:
        print("Usage: python explore_volta_api.py [projects|financials <main> <sub>]", file=sys.stderr)
        sys.exit(1)
