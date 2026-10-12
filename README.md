# Skin Draft LoL

Aplicação web para amigos cadastrarem coleções de skins de League of Legends, criarem salas e descobrirem combinações temáticas possíveis (do time inteiro às duplas).

**Stack:** React + TypeScript + Vite · Tailwind CSS · Supabase (Auth, PostgreSQL, Realtime, RLS)

## Começar

1. Crie um projeto no [Supabase](https://supabase.com).
2. No SQL Editor, execute as migrations em ordem:
   `001_initial.sql`, `002_aram_pool.sql` e `003_theme_matches.sql`.
3. Em Authentication → Providers, mantenha Email habilitado (para MVP local, desative “Confirm email” se quiser login imediato).
4. Copie as chaves:

```bash
cp .env.example .env
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (painel Connect).

5. Instale, importe o catálogo e rode:

```bash
npm install
npm run import:catalog
npm run dev
```

Sem secret key, o import gera `supabase/seed-catalog.sql` — cole no **SQL Editor** do Supabase e Execute. Com `SUPABASE_SECRET_KEY` no `.env`, o import grava direto via API.

## Fluxo do MVP

| Rota | Função |
| --- | --- |
| `/` | Criar / entrar em sala, atalhos |
| `/collection` | Catálogo + toggle de skins possuídas |
| `/room/:id` | Lobby, pool ARAM, prontidão |
| `/room/:id/matches` | Combinações temáticas ranqueadas |
| `/history` | Salas anteriores |

## Combinações temáticas

A RPC `analyze_theme_matches` lista temas em que **2+** participantes têm skin, do maior grupo às duplas, com uma skin sugerida por pessoa. Com `aram_pool` preenchido (sync LCU), só entram skins desses campeões.

## Pool ARAM (LCU)

Quem estiver com o **League aberto na select do ARAM** roda o sync local. O lobby atualiza o pool em tempo real; quit/reroll entram sozinhos.

```bash
npm run sync:aram -- --room=CODIGO
```

**Atalho no Windows:** rode uma vez `scripts\install-aram-shortcut.bat` — cria **Skin Draft ARAM** na área de trabalho. Ao abrir, pede o código da sala (e lembra o último).

Requer Node.js no PATH e o client do LoL (lê o `lockfile`). Sem pool, a análise usa a coleção inteira; com pool, só skins desses campeões.

## Estrutura

```
src/                 # UI React
supabase/migrations/ # Schema, RLS, RPCs
scripts/             # Data Dragon + sync ARAM (LCU)
```

## Fora do MVP

- Importação automática do inventário Riot
- Auth Riot / app desktop polido
- Ranking, IA e sincronização de compras
