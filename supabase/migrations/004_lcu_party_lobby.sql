-- Salas vinculadas ao party/lobby do LCU (sem código manual)

alter table public.draft_rooms
  alter column host_id drop not null;

alter table public.draft_rooms
  add column if not exists party_id text;

create unique index if not exists draft_rooms_party_id_uidx
  on public.draft_rooms (party_id)
  where party_id is not null;

-- Sala criada/obtida pelo sync LCU
create or replace function public.ensure_lcu_party_room(p_party_id text)
returns public.draft_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  attempt integer := 0;
  new_code text;
  clean_party text := nullif(trim(p_party_id), '');
begin
  if clean_party is null then
    raise exception 'party_id inválido';
  end if;

  select * into room
  from public.draft_rooms
  where party_id = clean_party
  limit 1;

  if room.id is not null then
    return room;
  end if;

  loop
    attempt := attempt + 1;
    new_code := public.generate_room_code(6);
    begin
      insert into public.draft_rooms (code, host_id, mode, status, party_id, settings)
      values (
        new_code,
        null,
        'theme',
        'waiting',
        clean_party,
        '{"avoid_duplicate_skins": true, "aram_pool": []}'::jsonb
      )
      returning * into room;
      exit;
    exception
      when unique_violation then
        -- corrida: outro sync criou a sala com o mesmo party_id
        select * into room
        from public.draft_rooms
        where party_id = clean_party
        limit 1;
        if room.id is not null then
          return room;
        end if;
        if attempt >= 10 then
          raise;
        end if;
    end;
  end loop;

  return room;
end;
$$;

-- Entrar na sala do party (web). Primeiro autenticado vira host.
create or replace function public.join_party_room(p_party_id text)
returns public.draft_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  next_pos integer;
  clean_party text := nullif(trim(p_party_id), '');
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if clean_party is null then
    raise exception 'party_id inválido';
  end if;

  select * into room
  from public.draft_rooms
  where party_id = clean_party
  limit 1;

  if room.id is null then
    room := public.ensure_lcu_party_room(clean_party);
  end if;

  if room.host_id is null then
    update public.draft_rooms
    set host_id = auth.uid()
    where id = room.id
      and host_id is null
    returning * into room;
  end if;

  select coalesce(max(position), -1) + 1 into next_pos
  from public.draft_participants
  where room_id = room.id;

  insert into public.draft_participants (room_id, user_id, position, is_ready)
  values (room.id, auth.uid(), next_pos, false)
  on conflict (room_id, user_id) do nothing;

  select * into room from public.draft_rooms where id = room.id;
  return room;
end;
$$;

-- Atualiza pool ARAM pela party (usado pelo .exe)
create or replace function public.sync_lcu_party(
  p_party_id text,
  p_champion_ids text[] default '{}',
  p_open_hint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  clean_ids text[];
begin
  room := public.ensure_lcu_party_room(p_party_id);

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
  where id = room.id
  returning * into room;

  return jsonb_build_object(
    'room_id', room.id,
    'room_code', room.code,
    'party_id', room.party_id,
    'aram_count', coalesce(cardinality(clean_ids), 0),
    'path', '/party/' || room.party_id
  );
end;
$$;

-- Leitura pública da sala por party (só metadados básicos)
create or replace function public.get_room_by_party(p_party_id text)
returns public.draft_rooms
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.draft_rooms
  where party_id = nullif(trim(p_party_id), '')
  limit 1;
$$;

-- RLS: permitir select de salas com party_id conhecido via função;
-- participantes continuam vendo pela policy existente.
-- Ajuste: host null — updates de settings só via RPCs security definer.

drop policy if exists "rooms_update_host" on public.draft_rooms;
create policy "rooms_update_host" on public.draft_rooms
  for update using (
    host_id = auth.uid()
    or (host_id is null and public.is_room_participant(id))
  )
  with check (
    host_id = auth.uid()
    or host_id is null
  );

grant execute on function public.ensure_lcu_party_room(text) to anon, authenticated;
grant execute on function public.join_party_room(text) to authenticated;
grant execute on function public.sync_lcu_party(text, text[], text) to anon, authenticated;
grant execute on function public.get_room_by_party(text) to anon, authenticated;
