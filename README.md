# Skin Draft LoL

Aplicação web para amigos cadastrarem coleções de skins de League of Legends, criarem salas e sortearem combinações visualmente harmoniosas.

**Stack:** React + TypeScript + Vite · Tailwind CSS · Supabase (Auth, PostgreSQL, Realtime, RLS)

## Começar

1. Crie um projeto no [Supabase](https://supabase.com).
2. No SQL Editor, execute `supabase/migrations/001_initial.sql`.
3. Em Authentication → Providers, mantenha Email habilitado (para MVP local, desative “Confirm email” se quiser login imediato).
4. Copie as chaves:

```bash
cp .env.example .env
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Para importar o catálogo, use também `SUPABASE_SERVICE_ROLE_KEY`.

5. Instale e rode:

```bash
npm install
npm run import:catalog
npm run dev
```

## Fluxo do MVP

| Rota | Função |
| --- | --- |
| `/` | Criar / entrar em sala, atalhos |
| `/collection` | Catálogo + toggle de skins possuídas |
| `/room/:id` | Lobby com código, prontidão e regras |
| `/room/:id/result` | Resultado sincronizado |
| `/history` | Salas anteriores |

## Sorteio

O sorteio roda na RPC transacional `run_draft`:

- **Livre** — disponível no MVP
- **Temático** — exige tema compartilhado nas coleções (temas inferidos na importação)
- **Cores** — reservado; exige enriquecimento de `skin_colors`

Regras: sem coleção vazia; skins distintas quando `avoid_duplicate_skins` está ativo; novo sorteio cria nova `round` e preserva histórico.

## Estrutura

```
src/                 # UI React
supabase/migrations/ # Schema, RLS, RPCs
scripts/             # Importação Data Dragon
```

## Fora do MVP

- Importação automática do inventário Riot
- Auth Riot / partidas ao vivo
- Ranking, IA e sincronização de compras
