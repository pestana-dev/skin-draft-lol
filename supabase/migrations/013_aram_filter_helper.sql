-- Unifica filtro ARAM (regra 012): só filtra com queue_kind=aram e pool não vazio.
-- SR nunca filtra. Corrige run_draft / set_theme_pick / update_aram_pool.

create or replace function public.should_filter_aram(p_settings jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(nullif(trim(p_settings->>'queue_kind'), ''), 'unknown') = 'aram'
    and coalesce(
      cardinality(
        coalesce(
          array(select jsonb_array_elements_text(p_settings->'aram_pool')),
          '{}'::text[]
        )
      ),
      0
    ) > 0;
$$;

grant execute on function public.should_filter_aram(jsonb) to anon, authenticated;

create index if not exists player_skins_player_id_idx
  on public.player_skins (player_id);

-- ---------------------------------------------------------------------------
-- update_aram_pool: limpar pool não muda filtro residual em SR
-- ---------------------------------------------------------------------------
create or replace function public.update_aram_pool(
  p_code text,
  p_champion_ids text[] default '{}'
)
returns public.draft_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  clean_ids text[];
  kind text;
  next_settings jsonb;
begin
  if coalesce(cardinality(p_champion_ids), 0) = 0 then
    clean_ids := '{}'::text[];
  else
    clean_ids := public.map_lcu_champion_ids(p_champion_ids);
  end if;

  select * into room
  from public.draft_rooms
  where upper(code) = upper(trim(p_code));

  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  kind := coalesce(nullif(trim(room.settings->>'queue_kind'), ''), 'unknown');

  next_settings := coalesce(room.settings, '{}'::jsonb)
    || jsonb_build_object(
      'aram_pool', to_jsonb(clean_ids),
      'aram_synced_at', now()::text
    );

  -- SR: pool sempre vazio e kind permanece sr
  if kind = 'sr' then
    next_settings := next_settings
      || jsonb_build_object('aram_pool', '[]'::jsonb, 'queue_kind', 'sr');
  elsif coalesce(cardinality(clean_ids), 0) = 0 and kind = 'unknown' then
    -- Pool limpo sem fila explícita: não deixar lixo sugerindo ARAM
    next_settings := next_settings || jsonb_build_object('queue_kind', 'unknown');
  end if;

  update public.draft_rooms
  set settings = next_settings
  where id = room.id
  returning * into room;

  return room;
end;
$$;

grant execute on function public.update_aram_pool(text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_theme_pick: usa should_filter_aram
-- ---------------------------------------------------------------------------
create or replace function public.set_theme_pick(
  p_room_id uuid,
  p_player_id uuid,
  p_theme_id uuid,
  p_skin_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  skin_row record;
  theme_row public.skin_themes;
  picks jsonb;
  pid text := p_player_id::text;
  other_key text;
  other jsonb;
  filter_aram boolean;
  aram_ids text[];
begin
  if p_room_id is null or p_player_id is null then
    raise exception 'Sala ou jogador inválido';
  end if;

  select * into room from public.draft_rooms where id = p_room_id;
  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  if not exists (
    select 1
    from public.draft_participants dp
    where dp.room_id = p_room_id
      and dp.player_id = p_player_id
  ) then
    raise exception 'Você não está nesta sala';
  end if;

  picks := coalesce(room.settings->'theme_picks', '{}'::jsonb);

  for other_key in select jsonb_object_keys(picks)
  loop
    if not exists (
      select 1
      from public.draft_participants dp
      where dp.room_id = p_room_id
        and dp.player_id::text = other_key
    ) then
      picks := picks - other_key;
    end if;
  end loop;

  if p_skin_id is null
     or nullif(trim(p_skin_id), '') is null
     or (
       picks->pid->>'skin_id' is not null
       and picks->pid->>'skin_id' = p_skin_id
       and picks->pid->>'theme_id' = p_theme_id::text
     )
  then
    picks := picks - pid;
    update public.draft_rooms
    set settings = jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{theme_picks}',
      picks,
      true
    )
    where id = p_room_id
    returning * into room;

    return jsonb_build_object(
      'ok', true,
      'cleared', true,
      'theme_picks', coalesce(room.settings->'theme_picks', '{}'::jsonb)
    );
  end if;

  if p_theme_id is null then
    raise exception 'Tema inválido';
  end if;

  select * into theme_row from public.skin_themes where id = p_theme_id;
  if theme_row.id is null then
    raise exception 'Tema não encontrado';
  end if;

  select
    s.id as skin_id,
    s.name as skin_name,
    s.champion_id,
    s.splash_url,
    s.tile_url,
    c.name as champion_name,
    c.image_url as champion_image_url
  into skin_row
  from public.skins s
  join public.champions c on c.id = s.champion_id
  join public.skin_theme_members stm
    on stm.skin_id = s.id and stm.theme_id = p_theme_id
  join public.player_skins ps
    on ps.skin_id = s.id and ps.player_id = p_player_id
  where s.id = p_skin_id
  limit 1;

  if skin_row.skin_id is null then
    raise exception 'Skin inválida para este tema ou fora da sua coleção';
  end if;

  aram_ids := public.map_lcu_champion_ids(
    coalesce(
      array(select jsonb_array_elements_text(room.settings->'aram_pool')),
      '{}'::text[]
    )
  );
  filter_aram := public.should_filter_aram(room.settings);

  if filter_aram and not (skin_row.champion_id = any (aram_ids)) then
    raise exception 'Campeão fora do pool ARAM';
  end if;

  for other_key, other in select * from jsonb_each(picks)
  loop
    if other_key = pid then
      continue;
    end if;
    if other->>'champion_id' = skin_row.champion_id then
      raise exception 'Campeão já escolhido por outra pessoa';
    end if;
  end loop;

  picks := jsonb_set(
    picks,
    array[pid],
    jsonb_build_object(
      'player_id', p_player_id,
      'skin_id', skin_row.skin_id,
      'skin_name', skin_row.skin_name,
      'champion_id', skin_row.champion_id,
      'champion_name', skin_row.champion_name,
      'champion_image_url', skin_row.champion_image_url,
      'splash_url', skin_row.splash_url,
      'tile_url', skin_row.tile_url,
      'theme_id', theme_row.id,
      'theme_slug', theme_row.slug,
      'theme_name', theme_row.name,
      'picked_at', now()
    ),
    true
  );

  update public.draft_rooms
  set settings = jsonb_set(
    coalesce(settings, '{}'::jsonb),
    '{theme_picks}',
    picks,
    true
  )
  where id = p_room_id
  returning * into room;

  return jsonb_build_object(
    'ok', true,
    'cleared', false,
    'pick', picks->pid,
    'theme_picks', coalesce(room.settings->'theme_picks', '{}'::jsonb)
  );
end;
$$;

grant execute on function public.set_theme_pick(uuid, uuid, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- run_draft: usa should_filter_aram
-- ---------------------------------------------------------------------------
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
  filter_aram boolean := false;
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

  aram_pool := public.map_lcu_champion_ids(
    coalesce(
      array(select jsonb_array_elements_text(room.settings->'aram_pool')),
      '{}'::text[]
    )
  );
  filter_aram := public.should_filter_aram(room.settings);
  if not filter_aram then
    aram_pool := '{}'::text[];
  end if;

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
        and (not filter_aram or exists (
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
        and (not filter_aram or s.champion_id = any (aram_pool))
        and (not avoid_dup or ps.skin_id <> all (used_skins))
      order by random()
      limit 1;
    else
      select ps.skin_id into chosen_skin_id
      from public.player_skins ps
      join public.skins s on s.id = ps.skin_id
      where ps.player_id = participant.player_id
        and s.is_available = true
        and (not filter_aram or s.champion_id = any (aram_pool))
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
        and (not filter_aram or s.champion_id = any (aram_pool))
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

grant execute on function public.run_draft(uuid) to anon, authenticated;
