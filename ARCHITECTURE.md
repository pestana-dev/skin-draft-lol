# Arquitetura — Skin Draft LoL

## Decisão: Tauri (não Electron)

| Critério | Tauri | Electron |
| --- | --- | --- |
| Licença | MIT / Apache 2.0 (grátis) | MIT (grátis) |
| Tamanho do app | Menor (WebView do SO) | Maior (Chromium embutido) |
| Companion tipo Blitz | Bom encaixe | Também funciona |
| LCU / nativo | Comandos Rust no processo | Node no main process |

Escolhemos **Tauri 2**. Produto principal = **app desktop** ligado ao League Client. Sem login de e-mail.

## Identidade LCU

1. Ao abrir, o Rust lê o lockfile do LoL e o summoner atual (`puuid` + Riot ID).
2. Inventário de skins (`/lol-inventory/v2/inventory/CHAMPION_SKIN`) → RPC `sync_player_skins`.
3. Party/lobby → membros por `puuid` → RPC `sync_lcu_party_session` monta a sala.
4. Recomendações (`analyze_theme_matches`) usam `player_skins` já salvas — amigo sem app aberto ainda conta se syncou antes.

Confiança: o desktop chama RPCs `security definer` com a chave do `.env` (mesmo modelo do sync Python legado).

## Monorepo

```
skin-draft-lol/
├── apps/
│   ├── web/                 # UI React (embutida no Tauri; browser só avisa)
│   └── desktop/             # Shell Tauri + módulo LCU (Rust)
├── scripts/                 # import catalog, sync LCU Python legado
├── supabase/                # migrations SQL (001…005)
└── ARCHITECTURE.md
```

## Fluxo

```
LoL (LCU) → Tauri Rust → Supabase RPCs → React UI
```

## Comandos

```bash
npm install
npm run dev:desktop   # produto
npm run import:catalog
# SQL: migrations 001 → 005 no Supabase
```

## Config desktop

O processo Rust lê (nessa ordem de preferência):

- `SUPABASE_URL` / `VITE_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` ou `VITE_SUPABASE_PUBLISHABLE_KEY`
- Arquivos: `.env` na raiz do repo, `config.env` ao lado do exe, `%LOCALAPPDATA%\SkinDraftLoL\config.env`

A UI web continua usando só a publishable key (leitura + RPCs liberadas para `anon`).
