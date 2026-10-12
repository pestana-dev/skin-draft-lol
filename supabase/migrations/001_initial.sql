-- Skin Draft LoL — schema inicial
-- Execute no SQL Editor do Supabase (ou via CLI).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create table if not exists public.champions (
  id text primary key,
  name text not null,
  key text,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.skins (
  id text primary key,
  champion_id text not null references public.champions (id) on delete cascade,
  name text not null,
  splash_url text,
  tile_url text,
  rarity text,
  is_available boolean not null default true,
  num integer,
  created_at timestamptz not null default now()
);

create index if not exists skins_champion_id_idx on public.skins (champion_id);
create index if not exists skins_name_idx on public.skins using gin (to_tsvector('simple', name));

create table if not exists public.skin_themes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.skin_theme_members (
  theme_id uuid not null references public.skin_themes (id) on delete cascade,
  skin_id text not null references public.skins (id) on delete cascade,
  primary key (theme_id, skin_id)
);

create table if not exists public.skin_colors (
  id uuid primary key default gen_random_uuid(),
  skin_id text not null references public.skins (id) on delete cascade,
  hex text not null,
  weight real not null default 1 check (weight > 0),
  unique (skin_id, hex)
);

-- ---------------------------------------------------------------------------
-- Jogadores e coleções
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_skins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  skin_id text not null references public.skins (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, skin_id)
);

create index if not exists user_skins_skin_id_idx on public.user_skins (skin_id);

-- ---------------------------------------------------------------------------
-- Salas e resultados
-- ---------------------------------------------------------------------------

create table if not exists public.draft_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null default 'free' check (mode in ('theme', 'color', 'free')),
  status text not null default 'waiting'
    check (status in ('waiting', 'ready', 'completed', 'cancelled')),
  settings jsonb not null default '{"avoid_duplicate_skins": true}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.draft_participants (
  room_id uuid not null references public.draft_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null default 0,
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.draft_results (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.draft_rooms (id) on delete cascade,
  round integer not null default 1,
  skin_id text not null references public.skins (id),
  user_id uuid not null references public.profiles (id),
  slot integer not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (room_id, round, user_id),
  unique (room_id, round, skin_id)
);

create index if not exists draft_results_room_round_idx
  on public.draft_results (room_id, round);

-- ---------------------------------------------------------------------------
-- Profile bootstrap
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'Jogador'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.generate_room_code(length integer default 6)
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..length loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.is_room_participant(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.draft_participants dp
    where dp.room_id = p_room_id
      and dp.user_id = auth.uid()
  );
$$;

create or replace function public.create_draft_room(p_mode text default 'free')
returns public.draft_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  new_room public.draft_rooms;
  attempt integer := 0;
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if p_mode not in ('theme', 'color', 'free') then
    raise exception 'Modo inválido';
  end if;

  loop
    attempt := attempt + 1;
    new_code := public.generate_room_code(6);
    begin
      insert into public.draft_rooms (code, host_id, mode, status)
      values (new_code, auth.uid(), p_mode, 'waiting')
      returning * into new_room;
      exit;
    exception when unique_violation then
      if attempt >= 10 then
        raise;
      end if;
    end;
  end loop;

  insert into public.draft_participants (room_id, user_id, position, is_ready)
  values (new_room.id, auth.uid(), 0, false);

  return new_room;
end;
$$;

create or replace function public.join_draft_room(p_code text)
returns public.draft_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.draft_rooms;
  next_pos integer;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into room
  from public.draft_rooms
  where upper(code) = upper(trim(p_code));

  if room.id is null then
    raise exception 'Sala não encontrada';
  end if;

  if room.status = 'cancelled' then
    raise exception 'Sala cancelada';
  end if;

  select coalesce(max(position), -1) + 1 into next_pos
  from public.draft_participants
  where room_id = room.id;

  insert into public.draft_participants (room_id, user_id, position, is_ready)
  values (room.id, auth.uid(), next_pos, false)
  on conflict (room_id, user_id) do nothing;

  return room;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sorteio (modo livre primeiro; tema e cor com fallbacks)
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
  eligible_count integer;
  theme_slug text;
  theme_name text;
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

  if exists (
    select 1
    from public.draft_participants dp
    where dp.room_id = room.id
      and not exists (
        select 1 from public.user_skins us where us.user_id = dp.user_id
      )
  ) then
    raise exception 'Todos os participantes precisam ter skins na coleção';
  end if;

  avoid_dup := coalesce((room.settings->>'avoid_duplicate_skins')::boolean, true);

  select coalesce(max(round), 0) + 1 into next_round
  from public.draft_results
  where room_id = room.id;

  -- Modo temático: encontra tema compartilhado
  if room.mode = 'theme' then
    select st.slug, st.name into theme_slug, theme_name
    from public.skin_themes st
    where (
      select count(distinct dp.user_id)
      from public.draft_participants dp
      join public.user_skins us on us.user_id = dp.user_id
      join public.skin_theme_members stm on stm.skin_id = us.skin_id
      where dp.room_id = room.id
        and stm.theme_id = st.id
    ) = (
      select count(*) from public.draft_participants where room_id = room.id
    )
    order by random()
    limit 1;

    if theme_slug is null then
      raise exception 'Não existe tema compartilhado completo entre as coleções';
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
      join public.skin_theme_members stm on stm.skin_id = us.skin_id
      join public.skin_themes st on st.id = stm.theme_id
      where us.user_id = participant.user_id
        and st.slug = theme_slug
        and (not avoid_dup or us.skin_id <> all (used_skins))
      order by random()
      limit 1;
    else
      -- free
      select us.skin_id into chosen_skin_id
      from public.user_skins us
      join public.skins s on s.id = us.skin_id
      where us.user_id = participant.user_id
        and s.is_available = true
        and (not avoid_dup or us.skin_id <> all (used_skins))
      order by random()
      limit 1;
    end if;

    if chosen_skin_id is null then
      -- Relaxa duplicata se necessário
      select us.skin_id into chosen_skin_id
      from public.user_skins us
      join public.skins s on s.id = us.skin_id
      left join public.skin_theme_members stm on stm.skin_id = us.skin_id
      left join public.skin_themes st on st.id = stm.theme_id
      where us.user_id = participant.user_id
        and s.is_available = true
        and (room.mode <> 'theme' or st.slug = theme_slug)
      order by random()
      limit 1;
    end if;

    if chosen_skin_id is null then
      raise exception 'Não foi possível sortear skin para um dos participantes';
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
        'theme_name', theme_name
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
    'results', result_rows
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.champions enable row level security;
alter table public.skins enable row level security;
alter table public.skin_themes enable row level security;
alter table public.skin_theme_members enable row level security;
alter table public.skin_colors enable row level security;
alter table public.profiles enable row level security;
alter table public.user_skins enable row level security;
alter table public.draft_rooms enable row level security;
alter table public.draft_participants enable row level security;
alter table public.draft_results enable row level security;

-- Catálogo público de leitura
create policy "champions_read" on public.champions for select using (true);
create policy "skins_read" on public.skins for select using (true);
create policy "themes_read" on public.skin_themes for select using (true);
create policy "theme_members_read" on public.skin_theme_members for select using (true);
create policy "skin_colors_read" on public.skin_colors for select using (true);

-- Profiles
create policy "profiles_read" on public.profiles for select using (true);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Coleção: dono gerencia; participantes da sala podem ver coleções uns dos outros
create policy "user_skins_select" on public.user_skins
  for select using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.draft_participants me
      join public.draft_participants other
        on other.room_id = me.room_id
       and other.user_id = user_skins.user_id
      where me.user_id = auth.uid()
    )
  );

create policy "user_skins_insert_own" on public.user_skins
  for insert with check (auth.uid() = user_id);

create policy "user_skins_delete_own" on public.user_skins
  for delete using (auth.uid() = user_id);

-- Salas
create policy "rooms_select_participant" on public.draft_rooms
  for select using (
    host_id = auth.uid()
    or public.is_room_participant(id)
  );

create policy "rooms_update_host" on public.draft_rooms
  for update using (host_id = auth.uid()) with check (host_id = auth.uid());

create policy "participants_select" on public.draft_participants
  for select using (public.is_room_participant(room_id));

create policy "participants_update_own" on public.draft_participants
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "results_select" on public.draft_results
  for select using (public.is_room_participant(room_id));

-- Realtime
alter publication supabase_realtime add table public.draft_rooms;
alter publication supabase_realtime add table public.draft_participants;
alter publication supabase_realtime add table public.draft_results;

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on public.user_skins to authenticated;
grant update on public.profiles to authenticated;
grant update on public.draft_rooms to authenticated;
grant update on public.draft_participants to authenticated;
grant execute on function public.create_draft_room(text) to authenticated;
grant execute on function public.join_draft_room(text) to authenticated;
grant execute on function public.run_draft(uuid) to authenticated;
