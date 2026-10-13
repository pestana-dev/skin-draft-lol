# @skin-draft/desktop (Tauri)

App de PC: embute `@skin-draft/web` e fala com o LCU (summoner, inventário, party).

## Pré-requisitos

1. **Rust** — https://rustup.rs  
2. **Windows:** build tools do Visual Studio (C++) + WebView2  
   **macOS:** Xcode CLT (`xcode-select --install`)  
3. `.env` na raiz com `SUPABASE_URL` + chave (secret ou publishable)  
4. Detecção do LoL: pelo processo `LeagueClientUx` (`--app-port` /
   `--remoting-auth-token`), depois `lockfile` na pasta de instalação.
   Override opcional: `LEAGUE_LOCKFILE`

## Comandos

Na raiz do monorepo:

```bash
npm install
npm run dev:desktop
```

## Comandos Tauri (Rust → UI)

| Comando | Função |
| --- | --- |
| `lcu_status` | LoL conectado? summoner + party + espelho da Champ Select |
| `sync_me` | Upsert player + replace `player_skins` |
| `sync_party` | Sync inventário + monta sala pelos membros do party |
| `pick_champion_skin` | Pick campeão+skin na Champ Select do client (ARAM bench / SR action) |

Config Supabase: lê `.env` / `config.env`, ou valores embutidos no release (`SKIN_DRAFT_SUPABASE_*`).

Updates: `tauri-plugin-updater` + GitHub Releases (`latest.json`). Ver README da raiz.
