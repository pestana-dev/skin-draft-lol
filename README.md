# Skin Draft LoL

Companion de PC para amigos combinarem skins temáticas no League of Legends — sem criar conta.

**Stack:** React + Vite · Tauri 2 · Supabase · identidade via LCU (Riot ID / puuid)

Detalhes em [ARCHITECTURE.md](./ARCHITECTURE.md).

## Como funciona

1. Abra o **League Client** e o **Skin Draft**.
2. O app sincroniza sua coleção de skins automaticamente.
3. Entre num party/lobby no LoL — o lobby do Skin Draft monta sozinho com os Riot IDs do grupo.
4. Veja combinações temáticas mesmo se um amigo não tiver o app aberto (usa a coleção que ele já salvou antes).

## Estrutura

```
apps/web        UI React (dentro do Tauri)
apps/desktop    App PC + LCU (Rust)
scripts/        import Data Dragon, sync Python legado
supabase/       migrations SQL (001 → 007)
```

## Setup (dev)

1. Projeto no [Supabase](https://supabase.com).
2. No SQL Editor, execute as migrations em ordem (`001` … `007`).
3. Configure o `.env`:

```bash
cp .env.example .env
```

```bash
npm install
npm run import:catalog
npm run import:roles
```

Pré-requisito desktop: [Rust / rustup](https://rustup.rs).

```bash
npm run dev:desktop
```

## Distribuir para amigos (GitHub Releases)

O instalador Windows é gerado pelo workflow [`.github/workflows/release.yml`](./.github/workflows/release.yml). Cada release publica o `.exe` e um `latest.json` — o app checa updates sozinho.

### 1. Secrets no GitHub

Em **Settings → Secrets and variables → Actions**, crie:

| Secret | Valor |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Conteúdo de `apps/desktop/.tauri-keys/skin-draft.key` (só no seu PC; nunca commit) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Senha da chave (vazio se não tiver) |
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave publishable (embutida no exe para os amigos) |

A chave pública já está em `tauri.conf.json`. A privada fica só em `.tauri-keys/` (gitignored) e no secret.

### 2. Publicar uma versão

1. Suba a `version` em `apps/desktop/src-tauri/tauri.conf.json` (e opcionalmente nos `package.json`).
2. Commit + push, depois:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. O Action gera o Release com o instalador NSIS.
4. Mande o link do Release / `.exe` para os amigos. Nas próximas tags, o banner **Atualizar agora** no app baixa a versão nova.

### Build local (opcional)

```bash
# PowerShell — assinatura (mesma chave do secret)
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw apps\desktop\.tauri-keys\skin-draft.key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""  # se houver senha

npm run build:desktop
```

## Variáveis

| Variável | Uso |
| --- | --- |
| `VITE_SUPABASE_URL` | UI + bake no release |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | UI + bake no release |
| `SUPABASE_URL` | Desktop / import (opcional se igual à VITE_) |
| `SUPABASE_SECRET_KEY` | Preferida no PC local e `import:catalog` |
| `TAURI_SIGNING_PRIVATE_KEY` | Assina artefatos de update (CI / build release) |

## Sync LCU legado (Python)

Ainda disponível até o instalador Tauri cobrir tudo:

```bash
npm run build:aram-exe
```

## Comandos

| Comando | O quê |
| --- | --- |
| `npm run dev:desktop` | App Tauri + LCU |
| `npm run dev` | Só UI no browser (sem sync LCU) |
| `npm run import:catalog` | Importa skins (pt_BR) |
| `npm run import:roles` | Roles SR (Meraki) |
| `npm run build:desktop` | Instalador local |
