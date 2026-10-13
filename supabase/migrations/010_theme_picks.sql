-- Escolha manual de skin/campeão por participante (settings.theme_picks).
-- Clique único na UI → set_theme_pick. Mesmo skin de novo limpa a escolha.

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

  -- Remove picks de quem saiu do party
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

  -- Limpar escolha (skin nula ou toggle do mesmo skin)
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

  aram_ids := coalesce(
    array(select jsonb_array_elements_text(room.settings->'aram_pool')),
    '{}'::text[]
  );
  filter_aram :=
    coalesce(room.settings->>'queue_kind', '') = 'aram'
    or (
      coalesce(cardinality(aram_ids), 0) > 0
      and coalesce(room.settings->>'queue_kind', '') is distinct from 'sr'
    );

  if filter_aram and not (skin_row.champion_id = any (aram_ids)) then
    raise exception 'Campeão fora do pool ARAM';
  end if;

  -- Conflito de campeão com outro participante
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
