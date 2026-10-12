-- Matching: todas as skins por tema; fila ARAM/SR + roles

drop function if exists public.sync_lcu_party_session(text, jsonb, text[], text);

create or replace function public.sync_lcu_party_session(
  p_party_id text,
  p_members jsonb default '[]'::jsonb,
  p_champion_ids text[] default '{}',
  p_host_puuid text default null,
  p_queue_id bigint default null,
  p_queue_kind text default null
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
  roles jsonb := '{}'::jsonb;
  kind text := coalesce(nullif(trim(p_queue_kind), ''), 'unknown');
begin
  if clean_party is null then
    raise exception 'party_id inválido';
  end if;

  if kind not in ('aram', 'sr', 'unknown') then
    kind := 'unknown';
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

    roles := jsonb_set(
      roles,
      array[member_puuid],
      jsonb_build_object(
        'primary', nullif(trim(coalesce(member->>'primary_role', '')), ''),
        'secondary', nullif(trim(coalesce(member->>'secondary_role', '')), '')
      ),
      true
    );

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
      'primary_role', nullif(trim(coalesce(member->>'primary_role', '')), ''),
      'secondary_role', nullif(trim(coalesce(member->>'secondary_role', '')), ''),
      'last_inventory_sync_at', ply.last_inventory_sync_at,
      'skin_count', (
        select count(*)::int from public.player_skins ps where ps.player_id = ply.id
      )
    );

    pos := pos + 1;
  end loop;

  if coalesce(cardinality(member_ids), 0) > 0 then
    delete from public.draft_participants
    where room_id = room.id
      and not (player_id = any (member_ids));
  end if;

  update public.draft_rooms
  set settings = coalesce(settings, '{}'::jsonb)
    || jsonb_build_object(
      'aram_pool', to_jsonb(clean_ids),
      'aram_synced_at', now()::text,
      'queue_id', p_queue_id,
      'queue_kind', kind,
      'member_roles', roles,
      'unique_champions', true
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
    'queue_id', p_queue_id,
    'queue_kind', kind,
    'members', member_rows
  );
end;
$$;

grant execute on function public.sync_lcu_party_session(text, jsonb, text[], text, bigint, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Todas as opções por jogador/campeão; filtro ARAM só quando fila = aram
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

  select coalesce(
    array(select jsonb_array_elements_text(room.settings->'aram_pool')),
    '{}'::text[]
  ) into aram_pool;

  -- Pool ARAM só filtra quando a fila é ARAM e há campeões syncados
  filter_aram := queue_kind = 'aram' and coalesce(cardinality(aram_pool), 0) > 0;

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
      champion_id, champion_name, champion_image_url
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
          'skin_count', skin_count,
          'skins', skins
        )
        order by champion_name
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
        -- compat UI antiga
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
