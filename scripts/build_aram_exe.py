#!/usr/bin/env python3
"""Gera dist/SkinDraftARAM.exe autônomo (PyInstaller)."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
SRC = ROOT / "scripts" / "sync_aram.py"
DIST = ROOT / "dist"
BUILD = ROOT / "build" / "aram-exe"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if not ENV_PATH.is_file():
        raise SystemExit(f"Crie o arquivo .env em {ENV_PATH}")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def main() -> None:
    env = load_env()
    url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or ""
    key = (
        env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
        or env.get("VITE_SUPABASE_ANON_KEY")
        or ""
    )
    app = env.get("VITE_APP_URL") or env.get("APP_URL") or "http://localhost:5173"
    if not url or not key:
        raise SystemExit("Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env")

    source = SRC.read_text(encoding="utf-8")
    source = re.sub(
        r'BAKED_SUPABASE_URL = ""',
        f"BAKED_SUPABASE_URL = {url!r}",
        source,
        count=1,
    )
    source = re.sub(
        r'BAKED_SUPABASE_KEY = ""',
        f"BAKED_SUPABASE_KEY = {key!r}",
        source,
        count=1,
    )
    source = re.sub(
        r'BAKED_APP_URL = ""',
        f"BAKED_APP_URL = {app!r}",
        source,
        count=1,
    )

    baked = ROOT / "scripts" / "_sync_aram_baked.py"
    baked.write_text(source, encoding="utf-8")

    print("Instalando PyInstaller (se preciso)...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--quiet", "pyinstaller"],
    )

    DIST.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)

    print("Compilando SkinDraftARAM.exe...")
    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--console",
            "--name",
            "SkinDraftARAM",
            "--distpath",
            str(DIST),
            "--workpath",
            str(BUILD),
            "--specpath",
            str(BUILD),
            str(baked),
        ],
    )

    exe = DIST / "SkinDraftARAM.exe"
    if not exe.is_file():
        raise SystemExit("Build falhou: exe nao encontrado")

    print(f"\nPronto: {exe}")
    print(f"Site embutido: {app}")
    print("O host so abre o .exe com o LoL no party — sem codigo.")


if __name__ == "__main__":
    main()
