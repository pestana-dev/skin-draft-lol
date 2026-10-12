-- Identidade LCU: players por puuid, sem Supabase Auth

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  puuid text not null unique,
  game_name text,
  tag_line text,
  display_name text not null,
  last_inventory_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_display_name_idx on public.players (display_name);

create table if not exists public.player_skins (
  player_id uuid not null references public.players (id) on delete cascade,
  skin_id text not null references public.skins (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_id, skin_id)
);

create index if not exists player_skins_skin_id_idx on public.player_skins (skin_id);

-- ---------------------------------------------------------------------------
-- Migrar FKs das salas para players
-- ---------------------------------------------------------------------------

-- Limpa sessões antigas atadas a auth.profiles (redesign)
truncate table public.draft_results restart identity cascade;
truncate table public.draft_participants restart identity cascade;
update public.draft_rooms set host_id = null;

alter table public.draft_participants drop constraint if exists draft_participants_user_id_fkey;
alter table public.draft_results drop constraint if exists draft_results_user_id_fkey;
alter table public.draft_rooms drop constraint if exists draft_rooms_host_id_fkey;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'draft_participants' and column_name = 'user_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'draft_participants' and column_name = 'player_id'
  ) then
    alter table public.draft_participants rename column user_id to player_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'draft_results' and column_name = 'user_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'draft_results' and column_name = 'player_id'
  ) then
    alter table public.draft_results rename column user_id to player_id;
  end if;
end $$;

alter table public.draft_participants
  add constraint draft_participants_player_id_fkey
  foreign key (player_id) references public.players (id) on delete cascade;

alter table public.draft_results
  add constraint draft_results_player_id_fkey
  foreign key (player_id) references public.players (id);

alter table public.draft_rooms
  add constraint draft_rooms_host_id_fkey
  foreign key (host_id) references public.players (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.player_display_name(p_game_name text, p_tag_line text)
returns text
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_game_name, '')), '') is not null
     and nullif(trim(coalesce(p_tag_line, '')), '') is not null
      then trim(p_game_name) || '#' || trim(p_tag_line)
    when nullif(trim(coalesce(p_game_name, '')), '') is not null
      then trim(p_game_name)
    else 'Jogador'
  end;
$$;

-- Mapeia itemId LCU (Data Dragon skin id) → skins.id (ChampionKey_num)
create or replace function public.map_lcu_skin_ids(p_item_ids bigint[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct s.id), '{}'::text[])
  from public.skins s
  join public.champions c on c.id = s.champion_id
  where s.is_available = true
    and c.key ~ '^[0-9]+$'
    and (c.key::bigint * 1000 + coalesce(s.num, 0)) = any (coalesce(p_item_ids, '{}'::bigint[]));
$$;

-- ---------------------------------------------------------------------------
-- RPCs LCU
-- ---------------------------------------------------------------------------

create or replace function public.upsert_player_lcu(
  p_puuid text,
  p_game_name text default null,
  p_tag_line text default null
)
returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_puuid text := nullif(trim(p_puuid), '');
  row public.players;
  nice_name text;
begin
  if clean_puuid is null then
    raise exception 'puuid inválido';
  end if;

  nice_name := public.player_display_name(p_game_name, p_tag_line);

  insert into public.players (puuid, game_name, tag_line, display_name, updated_at)
  values (
    clean_puuid,
    nullif(trim(coalesce(p_game_name, '')), ''),
    nullif(trim(coalesce(p_tag_line, '')), ''),
    nice_name,
    now()
  )
  on conflict (puuid) do update set
    game_name = coalesce(excluded.game_name, public.players.game_name),
    tag_line = coalesce(excluded.tag_line, public.players.tag_line),
    display_name = case
      when excluded.game_name is not null then excluded.display_name
      else public.players.display_name
    end,
    updated_at = now()
  returning * into row;

  return row;
end;
$$;

drop function if exists public.sync_player_skins(text, bigint[]);
drop function if exists public.sync_player_skins(text, bigint[], text, text);

create or replace function public.sync_player_skins(
  p_puuid text,
  p_lcu_item_ids bigint[] default '{}',
  p_game_name text default null,
  p_tag_line text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ply public.players;
  mapped text[];
  inserted_count integer := 0;
begin
  ply := public.upsert_player_lcu(p_puuid, p_game_name, p_tag_line);

  mapped := public.map_lcu_skin_ids(coalesce(p_lcu_item_ids, '{}'::bigint[]));

  delete from public.player_skins where player_id = ply.id;

  if coalesce(cardinality(mapped), 0) > 0 then
    insert into public.player_skins (player_id, skin_id)
    select ply.id, x from unnest(mapped) as x
    on conflict do nothing;
    get diagnostics inserted_count = row_count;
  end if;

  update public.players
  set last_inventory_sync_at = now(), updated_at = now()
  where id = ply.id
  returning * into ply;

  return jsonb_build_object(
    'player_id', ply.id,
    'puuid', ply.puuid,
    'display_name', ply.display_name,
    'skin_count', inserted_count,
    'last_inventory_sync_at', ply.last_inventory_sync_at
  );
end;
$$;

-- Membros: [{puuid, game_name, tag_line}]
create or replace function public.sync_lcu_party_session(
  p_party_id text,
  p_members jsonb default '[]'::jsonb,
  p_champion_ids text[] default '{}',
  p_host_puuid text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  clean_party text := nullif(trim(p_party_id), '');
  clean_ids text[];
  member jsonb;
  member_puuid text;
  ply public.players;
  host_ply public.players;
  pos integer := 0;
  member_ids uuid[] := '{}';
  member_rows jsonb := '[]'::jsonb;
begin
  if clean_party is null then
    raise exception 'party_id inválido';
  end if;

  room := public.ensure_lcu_party_room(clean_party);

  select coalesce(array_agg(distinct x), '{}'::text[])
  into clean_ids
  from unnest(coalesce(p_champion_ids, '{}'::text[])) as x
  where nullif(trim(x), '') is not null;

  if nullif(trim(coalesce(p_host_puuid, '')), '') is not null then
    host_ply := public.upsert_player_lcu(p_host_puuid, null, null);
    if room.host_id is null or room.host_id is distinct from host_ply.id then
      update public.draft_rooms
      set host_id = host_ply.id
      where id = room.id
      returning * into room;
    end if;
  end if;

  for member in
    select * from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
  loop
    member_puuid := nullif(trim(coalesce(member->>'puuid', '')), '');
    if member_puuid is null then
      continue;
    end if;

    ply := public.upsert_player_lcu(
      member_puuid,
      member->>'game_name',
      member->>'tag_line'
    );

    member_ids := array_append(member_ids, ply.id);

    insert into public.draft_participants (room_id, player_id, position, is_ready)
    values (room.id, ply.id, pos, false)
    on conflict (room_id, player_id) do update
      set position = excluded.position;

    member_rows := member_rows || jsonb_build_object(
      'player_id', ply.id,
      'puuid', ply.puuid,
      'display_name', ply.display_name,
      'game_name', ply.game_name,
      'tag_line', ply.tag_line,
      'last_inventory_sync_at', ply.last_inventory_sync_at,
      'skin_count', (
        select count(*)::int from public.player_skins ps where ps.player_id = ply.id
      )
    );

    pos := pos + 1;
  end loop;

  -- Remove quem saiu do party
  if coalesce(cardinality(member_ids), 0) > 0 then
    delete from public.draft_participants
    where room_id = room.id
      and not (player_id = any (member_ids));
  end if;

  update public.draft_rooms
  set settings = jsonb_set(
    jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{aram_pool}',
      to_jsonb(clean_ids),
      true
    ),
    '{aram_synced_at}',
    to_jsonb(now()::text),
    true
  ),
  status = case when status = 'cancelled' then 'waiting' else status end
  where id = room.id
  returning * into room;

  return jsonb_build_object(
    'room_id', room.id,
    'room_code', room.code,
    'party_id', room.party_id,
    'host_id', room.host_id,
    'aram_count', coalesce(cardinality(clean_ids), 0),
    'members', member_rows
  );
end;
$$;

create or replace function public.get_player_by_puuid(p_puuid text)
returns public.players
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.players
  where puuid = nullif(trim(p_puuid), '')
  limit 1;
$$;

create or replace function public.get_room_lobby(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  parts jsonb;
begin
  select * into room from public.draft_rooms where id = p_room_id;
  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'room_id', dp.room_id,
        'player_id', dp.player_id,
        'position', dp.position,
        'is_ready', dp.is_ready,
        'joined_at', dp.joined_at,
        'player', jsonb_build_object(
          'id', p.id,
          'puuid', p.puuid,
          'game_name', p.game_name,
          'tag_line', p.tag_line,
          'display_name', p.display_name,
          'last_inventory_sync_at', p.last_inventory_sync_at,
          'skin_count', (
            select count(*)::int from public.player_skins ps where ps.player_id = p.id
          )
        )
      )
      order by dp.position, dp.joined_at
    ),
    '[]'::jsonb
  )
  into parts
  from public.draft_participants dp
  join public.players p on p.id = dp.player_id
  where dp.room_id = room.id;

  return jsonb_build_object(
    'room', to_jsonb(room),
    'participants', parts
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- analyze_theme_matches / run_draft → player_skins
-- ---------------------------------------------------------------------------

create or replace function public.analyze_theme_matches(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  aram_pool text[] := '{}';
  has_aram boolean := false;
  participant_total integer;
  result jsonb := '[]'::jsonb;
begin
  select * into room from public.draft_rooms where id = p_room_id;
  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  select coalesce(
    array(select jsonb_array_elements_text(room.settings->'aram_pool')),
    '{}'::text[]
  ) into aram_pool;
  has_aram := coalesce(cardinality(aram_pool), 0) > 0;

  select count(*) into participant_total
  from public.draft_participants
  where room_id = room.id;

  if participant_total < 2 then
    raise exception 'É preciso pelo menos 2 participantes para combinar';
  end if;

  with eligible as (
    select
      dp.player_id,
      p.display_name,
      ps.skin_id,
      s.name as skin_name,
      s.splash_url,
      s.tile_url,
      s.champion_id,
      c.name as champion_name,
      st.id as theme_id,
      st.slug as theme_slug,
      st.name as theme_name
    from public.draft_participants dp
    join public.players p on p.id = dp.player_id
    join public.player_skins ps on ps.player_id = dp.player_id
    join public.skins s on s.id = ps.skin_id and s.is_available = true
    join public.champions c on c.id = s.champion_id
    join public.skin_theme_members stm on stm.skin_id = s.id
    join public.skin_themes st on st.id = stm.theme_id
    where dp.room_id = room.id
      and (not has_aram or s.champion_id = any (aram_pool))
  ),
  suggested as (
    select distinct on (theme_id, player_id)
      theme_id,
      theme_slug,
      theme_name,
      player_id,
      display_name,
      skin_id,
      skin_name,
      splash_url,
      tile_url,
      champion_id,
      champion_name
    from eligible
    order by theme_id, player_id, skin_name
  ),
  grouped as (
    select
      theme_id,
      theme_slug,
      theme_name,
      count(*)::int as match_count,
      jsonb_agg(
        jsonb_build_object(
          'player_id', player_id,
          'user_id', player_id,
          'display_name', display_name,
          'skin_id', skin_id,
          'skin_name', skin_name,
          'splash_url', splash_url,
          'tile_url', tile_url,
          'champion_id', champion_id,
          'champion_name', champion_name
        )
        order by display_name
      ) as members
    from suggested
    group by theme_id, theme_slug, theme_name
    having count(*) >= 2
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'theme_id', theme_id,
        'theme_slug', theme_slug,
        'theme_name', theme_name,
        'match_count', match_count,
        'participant_total', participant_total,
        'members', members
      )
      order by match_count desc, theme_name asc
    ),
    '[]'::jsonb
  )
  into result
  from grouped;

  return jsonb_build_object(
    'room_id', room.id,
    'room_code', room.code,
    'participant_total', participant_total,
    'aram_pool', to_jsonb(aram_pool),
    'matches', result
  );
end;
$$;

create or replace function public.run_draft(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  participant record;
  chosen_skin_id text;
  used_skins text[] := '{}';
  slot_n integer := 0;
  next_round integer;
  result_rows jsonb := '[]'::jsonb;
  avoid_dup boolean := true;
  theme_slug text;
  theme_name text;
  aram_pool text[] := '{}';
  has_aram boolean := false;
begin
  select * into room from public.draft_rooms where id = p_room_id for update;
  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  if room.status = 'cancelled' then
    raise exception 'Sala cancelada';
  end if;

  if not exists (
    select 1 from public.draft_participants where room_id = room.id
  ) then
    raise exception 'Sala sem participantes';
  end if;

  select coalesce(
    array(select jsonb_array_elements_text(room.settings->'aram_pool')),
    '{}'::text[]
  ) into aram_pool;
  has_aram := coalesce(cardinality(aram_pool), 0) > 0;

  if exists (
    select 1
    from public.draft_participants dp
    where dp.room_id = room.id
      and not exists (
        select 1 from public.player_skins ps where ps.player_id = dp.player_id
      )
  ) then
    raise exception 'Todos os participantes precisam ter skins na coleção';
  end if;

  avoid_dup := coalesce((room.settings->>'avoid_duplicate_skins')::boolean, true);

  select coalesce(max(round), 0) + 1 into next_round
  from public.draft_results
  where room_id = room.id;

  if room.mode = 'theme' then
    select st.slug, st.name into theme_slug, theme_name
    from public.skin_themes st
    where (
      select count(distinct dp.player_id)
      from public.draft_participants dp
      join public.player_skins ps on ps.player_id = dp.player_id
      join public.skin_theme_members stm on stm.skin_id = ps.skin_id
      where dp.room_id = room.id
        and stm.theme_id = st.id
        and (not has_aram or exists (
          select 1 from public.skins s
          where s.id = ps.skin_id and s.champion_id = any (aram_pool)
        ))
    ) >= 2
    order by random()
    limit 1;
  end if;

  if room.mode = 'color' then
    raise exception 'Modo cores ainda não está disponível no MVP.';
  end if;

  for participant in
    select * from public.draft_participants
    where room_id = room.id
    order by position, joined_at
  loop
    slot_n := slot_n + 1;

    if room.mode = 'theme' and theme_slug is not null then
      select ps.skin_id into chosen_skin_id
      from public.player_skins ps
      join public.skins s on s.id = ps.skin_id
      join public.skin_theme_members stm on stm.skin_id = ps.skin_id
      join public.skin_themes st on st.id = stm.theme_id
      where ps.player_id = participant.player_id
        and st.slug = theme_slug
        and s.is_available = true
        and (not has_aram or s.champion_id = any (aram_pool))
        and (not avoid_dup or ps.skin_id <> all (used_skins))
      order by random()
      limit 1;
    else
      select ps.skin_id into chosen_skin_id
      from public.player_skins ps
      join public.skins s on s.id = ps.skin_id
      where ps.player_id = participant.player_id
        and s.is_available = true
        and (not has_aram or s.champion_id = any (aram_pool))
        and (not avoid_dup or ps.skin_id <> all (used_skins))
      order by random()
      limit 1;
    end if;

    if chosen_skin_id is null then
      select ps.skin_id into chosen_skin_id
      from public.player_skins ps
      join public.skins s on s.id = ps.skin_id
      where ps.player_id = participant.player_id
        and s.is_available = true
        and (not has_aram or s.champion_id = any (aram_pool))
      order by random()
      limit 1;
    end if;

    if chosen_skin_id is null then
      raise exception 'Não foi possível sortear skin para um dos participantes';
    end if;

    used_skins := array_append(used_skins, chosen_skin_id);

    insert into public.draft_results (room_id, round, skin_id, player_id, slot, meta)
    values (
      room.id,
      next_round,
      chosen_skin_id,
      participant.player_id,
      slot_n,
      jsonb_build_object(
        'mode', room.mode,
        'theme_slug', theme_slug,
        'theme_name', theme_name
      )
    );

    result_rows := result_rows || jsonb_build_object(
      'player_id', participant.player_id,
      'user_id', participant.player_id,
      'skin_id', chosen_skin_id,
      'slot', slot_n,
      'round', next_round
    );
  end loop;

  update public.draft_rooms set status = 'completed' where id = room.id;

  return jsonb_build_object(
    'room_id', room.id,
    'round', next_round,
    'mode', room.mode,
    'theme_slug', theme_slug,
    'theme_name', theme_name,
    'results', result_rows
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.players enable row level security;
alter table public.player_skins enable row level security;

drop policy if exists "players_read" on public.players;
create policy "players_read" on public.players for select using (true);

drop policy if exists "player_skins_read" on public.player_skins;
create policy "player_skins_read" on public.player_skins for select using (true);

-- Salas/participantes legíveis no companion (sem auth)
drop policy if exists "rooms_select_participant" on public.draft_rooms;
create policy "rooms_select_all" on public.draft_rooms for select using (true);

drop policy if exists "participants_select" on public.draft_participants;
create policy "participants_select_all" on public.draft_participants for select using (true);

drop policy if exists "results_select" on public.draft_results;
create policy "results_select_all" on public.draft_results for select using (true);

drop policy if exists "participants_update_own" on public.draft_participants;
drop policy if exists "rooms_update_host" on public.draft_rooms;

-- Grants
grant select on public.players to anon, authenticated;
grant select on public.player_skins to anon, authenticated;

grant execute on function public.upsert_player_lcu(text, text, text) to anon, authenticated;
grant execute on function public.sync_player_skins(text, bigint[], text, text) to anon, authenticated;
grant execute on function public.sync_lcu_party_session(text, jsonb, text[], text) to anon, authenticated;
grant execute on function public.get_player_by_puuid(text) to anon, authenticated;
grant execute on function public.get_room_lobby(uuid) to anon, authenticated;
grant execute on function public.map_lcu_skin_ids(bigint[]) to anon, authenticated;
grant execute on function public.analyze_theme_matches(uuid) to anon, authenticated;
grant execute on function public.run_draft(uuid) to anon, authenticated;
