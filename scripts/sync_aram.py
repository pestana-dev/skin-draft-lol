#!/usr/bin/env python3
"""
Skin Draft LoL — sync via lobby/party do LCU.

Fluxo:
  1. Detecta o party/lobby no League Client
  2. Cria/atualiza a sala no Supabase (sem código manual)
  3. Abre o site na sessão do party
  4. Enquanto estiver na select ARAM, sincroniza o pool de campeões

Uso:
  SkinDraftARAM.exe
  python scripts/sync_aram.py
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from base64 import b64encode
from pathlib import Path

POLL_MS = 2.5

BAKED_SUPABASE_URL = ""
BAKED_SUPABASE_KEY = ""
BAKED_APP_URL = ""

SSL_NO_VERIFY = ssl._create_unverified_context()


def app_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    path = Path(base) / "SkinDraftLoL"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_dotenv_nearby() -> None:
    here = Path(__file__).resolve().parent
    candidates = [here.parent / ".env", Path.cwd() / ".env"]
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.insert(0, exe_dir / ".env")
        candidates.insert(0, exe_dir / "config.env")

    for env_path in candidates:
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def config() -> tuple[str, str, str]:
    load_dotenv_nearby()
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("VITE_SUPABASE_URL")
        or BAKED_SUPABASE_URL
    ).rstrip("/")
    key = (
        os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
        or os.environ.get("VITE_SUPABASE_ANON_KEY")
        or BAKED_SUPABASE_KEY
    )
    app = (
        os.environ.get("VITE_APP_URL")
        or os.environ.get("APP_URL")
        or BAKED_APP_URL
        or "http://localhost:5173"
    ).rstrip("/")
    if not url or not key:
        raise SystemExit(
            "Supabase nao configurado. Recompile com npm run build:aram-exe "
            "ou coloque config.env ao lado do .exe."
        )
    return url, key, app


def lockfile_candidates() -> list[Path]:
    local_app = os.environ.get("LOCALAPPDATA", "")
    home = Path.home()
    paths = [
        Path(r"C:\Riot Games\League of Legends\lockfile"),
        Path(r"D:\Riot Games\League of Legends\lockfile"),
        Path(local_app) / "Riot Games" / "League of Legends" / "lockfile",
        home / "Riot Games" / "League of Legends" / "lockfile",
    ]
    custom = os.environ.get("LEAGUE_LOCKFILE")
    if custom:
        paths.insert(0, Path(custom))
    return paths


def read_lockfile() -> dict | None:
    for path in lockfile_candidates():
        if not path.is_file():
            continue
        try:
            raw = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        parts = raw.split(":")
        if len(parts) < 5:
            continue
        _name, _pid, port, password, protocol = parts[:5]
        try:
            return {
                "port": int(port),
                "password": password,
                "protocol": protocol or "https",
                "path": str(path),
            }
        except ValueError:
            continue
    return None


def lcu_get(lock: dict, pathname: str):
    auth = b64encode(f"riot:{lock['password']}".encode()).decode()
    url = f"https://127.0.0.1:{lock['port']}{pathname}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Basic {auth}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, context=SSL_NO_VERIFY, timeout=5) as res:
            body = res.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise
    except OSError:
        return None


def _dig_party_id(obj) -> str | None:
    if not isinstance(obj, dict):
        return None
    for key in ("partyId", "party_id", "id"):
        val = obj.get(key)
        if isinstance(val, str) and len(val) >= 8:
            # evita ids curtos demais / numericos de fila
            if key == "id" and val.isdigit():
                continue
            return val
    party = obj.get("party")
    if isinstance(party, dict):
        found = _dig_party_id(party)
        if found:
            return found
    return None


def party_key_from_champ_select(session: dict) -> str | None:
    puuids: list[str] = []
    for player in session.get("myTeam") or []:
        puuid = player.get("puuid")
        if isinstance(puuid, str) and puuid:
            puuids.append(puuid)
    if len(puuids) < 1:
        return None
    return "cs:" + "-".join(sorted(set(puuids)))


def detect_party_key(lock: dict) -> tuple[str | None, str]:
    """Retorna (party_key, fonte)."""
    for path in (
        "/lol-lobby/v2/lobby",
        "/lol-lobby/v2/party",
        "/lol-party/v1/party",
    ):
        data = lcu_get(lock, path)
        if not data:
            continue
        party_id = _dig_party_id(data)
        if party_id:
            return party_id, path

    session = lcu_get(lock, "/lol-champ-select/v1/session")
    if session:
        fallback = party_key_from_champ_select(session)
        if fallback:
            return fallback, "champ-select"

    return None, ""


def extract_champion_keys(session: dict) -> list[str]:
    keys: set[str] = set()

    def add(cid) -> None:
        if isinstance(cid, int) and cid > 0:
            keys.add(str(cid))

    for item in session.get("benchChampions") or []:
        add(item.get("championId"))
    for team_key in ("myTeam", "theirTeam"):
        for player in session.get(team_key) or []:
            add(player.get("championId"))
    return sorted(keys, key=lambda x: int(x))


def supabase_request(url: str, key: str, path: str, method: str = "GET", body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode("utf-8")
        return json.loads(text) if text else None


def map_keys_to_champions(url: str, key: str, keys: list[str]) -> list[dict]:
    if not keys:
        return []
    filter_ids = ",".join(urllib.parse.quote(k, safe="") for k in keys)
    rows = supabase_request(url, key, f"champions?select=id,key,name&key=in.({filter_ids})")
    by_key = {str(r["key"]): r for r in (rows or [])}
    missing = [k for k in keys if k not in by_key]
    if missing:
        print(f"Chaves sem campeao no catalogo: {', '.join(missing)}")
    return [by_key[k] for k in keys if k in by_key]


def sync_party(url: str, key: str, party_id: str, champion_ids: list[str]) -> dict:
    result = supabase_request(
        url,
        key,
        "rpc/sync_lcu_party",
        method="POST",
        body={
            "p_party_id": party_id,
            "p_champion_ids": champion_ids,
            "p_open_hint": None,
        },
    )
    if isinstance(result, list):
        return result[0] if result else {}
    return result or {}


def same_ids(a: list[str], b: list[str]) -> bool:
    return sorted(a) == sorted(b)


def open_party_page(app_url: str, party_id: str, opened: set[str]) -> None:
    if party_id in opened:
        return
    target = f"{app_url}/party/{urllib.parse.quote(party_id, safe='')}"
    print(f"Abrindo site: {target}")
    webbrowser.open(target)
    opened.add(party_id)
    (app_data_dir() / "last-party.txt").write_text(party_id, encoding="utf-8")


def main() -> None:
    url, key, app_url = config()
    print("Skin Draft — sync pelo lobby do LoL")
    print(f"Site: {app_url}")
    print("Entre no party/lobby (ou select ARAM). Nao precisa digitar codigo.")
    print("Ctrl+C para parar.\n")

    last_party: str | None = None
    last_ids: list[str] = []
    opened: set[str] = set()

    try:
        while True:
            lock = read_lockfile()
            if not lock:
                print("Aguardando League Client...")
                time.sleep(POLL_MS)
                continue

            party_id, source = detect_party_key(lock)
            if not party_id:
                print("Aguardando party/lobby ou select ARAM...")
                time.sleep(POLL_MS)
                continue

            if party_id != last_party:
                print(f"\nParty detectado ({source}): {party_id[:48]}...")
                last_party = party_id
                last_ids = []

            session = lcu_get(lock, "/lol-champ-select/v1/session")
            champion_ids: list[str] = []
            names = ""

            if session:
                keys = extract_champion_keys(session)
                champions = map_keys_to_champions(url, key, keys)
                champion_ids = [c["id"] for c in champions]
                names = ", ".join(c["name"] for c in champions)

            if not same_ids(champion_ids, last_ids) or party_id not in opened:
                try:
                    meta = sync_party(url, key, party_id, champion_ids)
                    open_party_page(app_url, party_id, opened)
                    if champion_ids:
                        print(f"Pool ARAM ({len(champion_ids)}): {names or champion_ids}")
                    else:
                        print(
                            "Sala do party pronta. Pool ARAM sincroniza ao entrar na select."
                        )
                    if meta.get("room_code"):
                        print(f"Codigo da sala (fallback): {meta['room_code']}")
                    last_ids = champion_ids
                except Exception as err:  # noqa: BLE001
                    print(f"Erro ao sincronizar: {err}")
            else:
                print(".", end="", flush=True)

            time.sleep(POLL_MS)
    except KeyboardInterrupt:
        print("\nEncerrado.")


if __name__ == "__main__":
    main()
