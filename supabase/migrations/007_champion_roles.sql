-- Rotas típicas dos campeões (SR): TOP, JUNGLE, MID, ADC, SUPPORT

alter table public.champions
  add column if not exists roles text[] not null default '{}';

comment on column public.champions.roles is
  'Rotas em que o campeão costuma jogar: TOP, JUNGLE, MID, ADC, SUPPORT';

create index if not exists champions_roles_gin_idx
  on public.champions using gin (roles);

-- analyze: inclui roles do campeão na resposta
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
      coalesce(c.roles, '{}'::text[]) as champion_roles,
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
      champion_roles,
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
