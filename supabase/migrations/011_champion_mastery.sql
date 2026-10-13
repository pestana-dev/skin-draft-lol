-- Maestria de campeões (sync via LCU) + uso no matching/recomendações.

create table if not exists public.player_champion_mastery (
  player_id uuid not null references public.players (id) on delete cascade,
  champion_id text not null references public.champions (id) on delete cascade,
  champion_level integer not null default 0,
  champion_points integer not null default 0,
  last_play_time timestamptz,
  updated_at timestamptz not null default now(),
  primary key (player_id, champion_id)
);

create index if not exists player_champion_mastery_points_idx
  on public.player_champion_mastery (player_id, champion_points desc);

alter table public.player_champion_mastery enable row level security;

drop policy if exists "player_champion_mastery_read" on public.player_champion_mastery;
create policy "player_champion_mastery_read"
  on public.player_champion_mastery for select using (true);

grant select on public.player_champion_mastery to anon, authenticated;

-- p_entries: [{ "championId": 103, "championLevel": 7, "championPoints": 123456, "lastPlayTime": 1710000000000 }]
create or replace function public.sync_player_mastery(
  p_puuid text,
  p_entries jsonb default '[]'::jsonb,
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
  entry jsonb;
  champ_key text;
  champ_id text;
  lvl integer;
  pts integer;
  last_ms bigint;
  kept text[] := '{}';
  synced_count integer := 0;
begin
  ply := public.upsert_player_lcu(p_puuid, p_game_name, p_tag_line);

  for entry in
    select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    champ_key := nullif(trim(coalesce(
      entry->>'championId',
      entry->>'champion_id',
      ''
    )), '');
    if champ_key is null then
      continue;
    end if;

    select c.id into champ_id
    from public.champions c
    where c.key = champ_key or c.id = champ_key
    limit 1;

    if champ_id is null then
      continue;
    end if;

    lvl := greatest(coalesce((entry->>'championLevel')::integer, (entry->>'champion_level')::integer, 0), 0);
    pts := greatest(coalesce((entry->>'championPoints')::integer, (entry->>'champion_points')::integer, 0), 0);
    last_ms := nullif(coalesce(entry->>'lastPlayTime', entry->>'last_play_time', ''), '')::bigint;

    insert into public.player_champion_mastery as pcm (
      player_id, champion_id, champion_level, champion_points, last_play_time, updated_at
    )
    values (
      ply.id,
      champ_id,
      lvl,
      pts,
      case when last_ms is null or last_ms <= 0 then null
           else to_timestamp(last_ms / 1000.0)
      end,
      now()
    )
    on conflict (player_id, champion_id) do update set
      champion_level = excluded.champion_level,
      champion_points = excluded.champion_points,
      last_play_time = excluded.last_play_time,
      updated_at = now();

    kept := array_append(kept, champ_id);
  end loop;

  if coalesce(cardinality(kept), 0) > 0 then
    delete from public.player_champion_mastery
    where player_id = ply.id
      and not (champion_id = any (kept));
  else
    delete from public.player_champion_mastery where player_id = ply.id;
  end if;

  select count(*)::int into synced_count
  from public.player_champion_mastery
  where player_id = ply.id;

  return jsonb_build_object(
    'player_id', ply.id,
    'puuid', ply.puuid,
    'mastery_count', synced_count
  );
end;
$$;

grant execute on function public.sync_player_mastery(text, jsonb, text, text) to anon, authenticated;

-- Matching: inclui mastery_level / mastery_points em cada campeão do jogador.
create or replace function public.analyze_theme_matches(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  aram_pool text[] := '{}';
  queue_kind text := 'unknown';
  filter_aram boolean := false;
  participant_total integer;
  result jsonb := '[]'::jsonb;
  roles jsonb := '{}'::jsonb;
begin
  select * into room from public.draft_rooms where id = p_room_id;
  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  queue_kind := coalesce(nullif(room.settings->>'queue_kind', ''), 'unknown');
  roles := coalesce(room.settings->'member_roles', '{}'::jsonb);

  aram_pool := public.map_lcu_champion_ids(
    coalesce(
      array(select jsonb_array_elements_text(room.settings->'aram_pool')),
      '{}'::text[]
    )
  );

  if coalesce(cardinality(aram_pool), 0) > 0 and queue_kind is distinct from 'sr' then
    filter_aram := true;
    if queue_kind = 'unknown' then
      queue_kind := 'aram';
    end if;
  else
    filter_aram := queue_kind = 'aram' and coalesce(cardinality(aram_pool), 0) > 0;
  end if;

  select count(*) into participant_total
  from public.draft_participants
  where room_id = room.id;

  if participant_total < 2 then
    raise exception 'É preciso pelo menos 2 participantes para combinar';
  end if;

  with eligible as (
    select
      dp.player_id,
      p.puuid,
      p.display_name,
      ps.skin_id,
      s.name as skin_name,
      s.splash_url,
      s.tile_url,
      s.champion_id,
      c.name as champion_name,
      c.image_url as champion_image_url,
      coalesce(c.roles, '{}'::text[]) as champion_roles,
      coalesce(pcm.champion_level, 0) as mastery_level,
      coalesce(pcm.champion_points, 0) as mastery_points,
      st.id as theme_id,
      st.slug as theme_slug,
      st.name as theme_name
    from public.draft_participants dp
    join public.players p on p.id = dp.player_id
    join public.player_skins ps on ps.player_id = dp.player_id
    join public.skins s on s.id = ps.skin_id and s.is_available = true
    join public.champions c on c.id = s.champion_id
    left join public.player_champion_mastery pcm
      on pcm.player_id = dp.player_id and pcm.champion_id = s.champion_id
    join public.skin_theme_members stm on stm.skin_id = s.id
    join public.skin_themes st on st.id = stm.theme_id
    where dp.room_id = room.id
      and (not filter_aram or s.champion_id = any (aram_pool))
  ),
  champ_skins as (
    select
      theme_id,
      theme_slug,
      theme_name,
      player_id,
      puuid,
      display_name,
      champion_id,
      champion_name,
      champion_image_url,
      champion_roles,
      max(mastery_level)::int as mastery_level,
      max(mastery_points)::int as mastery_points,
      jsonb_agg(
        jsonb_build_object(
          'skin_id', skin_id,
          'skin_name', skin_name,
          'splash_url', splash_url,
          'tile_url', tile_url
        )
        order by skin_name
      ) as skins,
      count(*)::int as skin_count
    from eligible
    group by
      theme_id, theme_slug, theme_name,
      player_id, puuid, display_name,
      champion_id, champion_name, champion_image_url, champion_roles
  ),
  player_rows as (
    select
      theme_id,
      theme_slug,
      theme_name,
      player_id,
      puuid,
      display_name,
      jsonb_agg(
        jsonb_build_object(
          'champion_id', champion_id,
          'champion_name', champion_name,
          'champion_image_url', champion_image_url,
          'roles', to_jsonb(champion_roles),
          'mastery_level', mastery_level,
          'mastery_points', mastery_points,
          'skin_count', skin_count,
          'skins', skins
        )
        order by mastery_points desc, champion_name
      ) as champions,
      sum(skin_count)::int as skin_count,
      count(*)::int as champion_count
    from champ_skins
    group by theme_id, theme_slug, theme_name, player_id, puuid, display_name
  ),
  grouped as (
    select
      theme_id,
      theme_slug,
      theme_name,
      count(*)::int as match_count,
      sum(skin_count)::int as option_count,
      jsonb_agg(
        jsonb_build_object(
          'player_id', player_id,
          'puuid', puuid,
          'display_name', display_name,
          'primary_role', roles -> puuid ->> 'primary',
          'secondary_role', roles -> puuid ->> 'secondary',
          'skin_count', skin_count,
          'champion_count', champion_count,
          'champions', champions
        )
        order by display_name
      ) as players
    from player_rows
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
        'option_count', option_count,
        'participant_total', participant_total,
        'players', players,
        'members', players
      )
      order by match_count desc, option_count desc, theme_name asc
    ),
    '[]'::jsonb
  )
  into result
  from grouped;

  return jsonb_build_object(
    'room_id', room.id,
    'room_code', room.code,
    'participant_total', participant_total,
    'queue_kind', queue_kind,
    'queue_id', room.settings->'queue_id',
    'unique_champions', true,
    'aram_pool', to_jsonb(aram_pool),
    'filter_aram', filter_aram,
    'matches', result
  );
end;
$$;

grant execute on function public.analyze_theme_matches(uuid) to anon, authenticated;
