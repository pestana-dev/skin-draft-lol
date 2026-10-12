-- Pool de campeões do ARAM (sincronizado via LCU) + filtro no sorteio

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
begin
  select coalesce(array_agg(distinct x), '{}'::text[])
  into clean_ids
  from unnest(coalesce(p_champion_ids, '{}'::text[])) as x
  where nullif(trim(x), '') is not null;

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
  )
  where upper(code) = upper(trim(p_code))
  returning * into room;

  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  return room;
end;
$$;

grant execute on function public.update_aram_pool(text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sorteio: respeita aram_pool quando presente
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
  has_aram boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into room from public.draft_rooms where id = p_room_id for update;
  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  if room.host_id <> auth.uid() then
    raise exception 'Apenas o anfitrião pode iniciar o sorteio';
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
    array(
      select jsonb_array_elements_text(room.settings->'aram_pool')
    ),
    '{}'::text[]
  ) into aram_pool;

  has_aram := coalesce(cardinality(aram_pool), 0) > 0;

  if exists (
    select 1
    from public.draft_participants dp
    where dp.room_id = room.id
      and not exists (
        select 1
        from public.user_skins us
        join public.skins s on s.id = us.skin_id
        where us.user_id = dp.user_id
          and s.is_available = true
          and (not has_aram or s.champion_id = any (aram_pool))
      )
  ) then
    if has_aram then
      raise exception 'Algum participante não tem skins dos campeões do pool ARAM';
    else
      raise exception 'Todos os participantes precisam ter skins na coleção';
    end if;
  end if;

  avoid_dup := coalesce((room.settings->>'avoid_duplicate_skins')::boolean, true);

  select coalesce(max(round), 0) + 1 into next_round
  from public.draft_results
  where room_id = room.id;

  if room.mode = 'theme' then
    select st.slug, st.name into theme_slug, theme_name
    from public.skin_themes st
    where (
      select count(distinct dp.user_id)
      from public.draft_participants dp
      join public.user_skins us on us.user_id = dp.user_id
      join public.skins s on s.id = us.skin_id
      join public.skin_theme_members stm on stm.skin_id = us.skin_id
      where dp.room_id = room.id
        and stm.theme_id = st.id
        and (not has_aram or s.champion_id = any (aram_pool))
    ) = (
      select count(*) from public.draft_participants where room_id = room.id
    )
    order by random()
    limit 1;

    if theme_slug is null then
      raise exception 'Não existe tema compartilhado completo no pool atual';
    end if;
  end if;

  if room.mode = 'color' then
    raise exception 'Modo cores ainda não está disponível no MVP. Use livre ou temático.';
  end if;

  for participant in
    select * from public.draft_participants
    where room_id = room.id
    order by position, joined_at
  loop
    slot_n := slot_n + 1;

    if room.mode = 'theme' then
      select us.skin_id into chosen_skin_id
      from public.user_skins us
      join public.skins s on s.id = us.skin_id
      join public.skin_theme_members stm on stm.skin_id = us.skin_id
      join public.skin_themes st on st.id = stm.theme_id
      where us.user_id = participant.user_id
        and st.slug = theme_slug
        and s.is_available = true
        and (not has_aram or s.champion_id = any (aram_pool))
        and (not avoid_dup or us.skin_id <> all (used_skins))
      order by random()
      limit 1;
    else
      select us.skin_id into chosen_skin_id
      from public.user_skins us
      join public.skins s on s.id = us.skin_id
      where us.user_id = participant.user_id
        and s.is_available = true
        and (not has_aram or s.champion_id = any (aram_pool))
        and (not avoid_dup or us.skin_id <> all (used_skins))
      order by random()
      limit 1;
    end if;

    if chosen_skin_id is null then
      select us.skin_id into chosen_skin_id
      from public.user_skins us
      join public.skins s on s.id = us.skin_id
      left join public.skin_theme_members stm on stm.skin_id = us.skin_id
      left join public.skin_themes st on st.id = stm.theme_id
      where us.user_id = participant.user_id
        and s.is_available = true
        and (not has_aram or s.champion_id = any (aram_pool))
        and (room.mode <> 'theme' or st.slug = theme_slug)
      order by random()
      limit 1;
    end if;

    if chosen_skin_id is null then
      raise exception 'Não foi possível sortear skin para um dos participantes (verifique o pool ARAM e as coleções)';
    end if;

    used_skins := array_append(used_skins, chosen_skin_id);

    insert into public.draft_results (room_id, round, skin_id, user_id, slot, meta)
    values (
      room.id,
      next_round,
      chosen_skin_id,
      participant.user_id,
      slot_n,
      jsonb_build_object(
        'mode', room.mode,
        'theme_slug', theme_slug,
        'theme_name', theme_name,
        'aram_pool', to_jsonb(aram_pool)
      )
    );

    result_rows := result_rows || jsonb_build_object(
      'user_id', participant.user_id,
      'skin_id', chosen_skin_id,
      'slot', slot_n,
      'round', next_round
    );
  end loop;

  update public.draft_rooms
  set status = 'completed'
  where id = room.id;

  return jsonb_build_object(
    'room_id', room.id,
    'round', next_round,
    'mode', room.mode,
    'theme_slug', theme_slug,
    'theme_name', theme_name,
    'aram_pool', aram_pool,
    'results', result_rows
  );
end;
$$;
