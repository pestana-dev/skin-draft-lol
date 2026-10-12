-- Análise de combinações temáticas (sem sorteio aleatório)

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
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if not public.is_room_participant(p_room_id) then
    raise exception 'Você não participa desta sala';
  end if;

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
      dp.user_id,
      p.display_name,
      us.skin_id,
      s.name as skin_name,
      s.splash_url,
      s.tile_url,
      s.champion_id,
      c.name as champion_name,
      st.id as theme_id,
      st.slug as theme_slug,
      st.name as theme_name
    from public.draft_participants dp
    join public.profiles p on p.id = dp.user_id
    join public.user_skins us on us.user_id = dp.user_id
    join public.skins s on s.id = us.skin_id and s.is_available = true
    join public.champions c on c.id = s.champion_id
    join public.skin_theme_members stm on stm.skin_id = s.id
    join public.skin_themes st on st.id = stm.theme_id
    where dp.room_id = room.id
      and (not has_aram or s.champion_id = any (aram_pool))
  ),
  -- Uma skin sugerida por (tema, usuário): primeira por nome
  suggested as (
    select distinct on (theme_id, user_id)
      theme_id,
      theme_slug,
      theme_name,
      user_id,
      display_name,
      skin_id,
      skin_name,
      splash_url,
      tile_url,
      champion_id,
      champion_name
    from eligible
    order by theme_id, user_id, skin_name
  ),
  grouped as (
    select
      theme_id,
      theme_slug,
      theme_name,
      count(*)::int as match_count,
      jsonb_agg(
        jsonb_build_object(
          'user_id', user_id,
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

grant execute on function public.analyze_theme_matches(uuid) to authenticated;
