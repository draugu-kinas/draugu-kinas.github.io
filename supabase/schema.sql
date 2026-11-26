-- ============================================================
--  movie night — database setup for Supabase
--  paste this whole file into: Supabase → SQL Editor → New query → Run
--  (safe to run once on a fresh project)
-- ============================================================

-- ---------- tables ----------

create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  number           int  not null default 1,
  title            text not null default 'movie night',
  tagline          text,
  theme            text not null default 'moss',
  colors           jsonb,           -- host's fine-tuned colours on top of the theme
  room             jsonb,           -- which furniture is in the room and in what style
  texts            jsonb,           -- host's own wording: missing = default, '' = hidden
  location         text,
  bring            text,
  final_date       date,
  final_time       text,
  status           text not null default 'open' check (status in ('open','locked','archived')),
  winner_movie_id  uuid,
  created_at       timestamptz not null default now(),
  archived_at      timestamptz
);

create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 24),
  bringing    text check (bringing is null or char_length(bringing) <= 60),
  created_at  timestamptz not null default now()
);

-- private: device tokens (never readable from the browser)
create table if not exists participant_secrets (
  participant_id uuid primary key references participants(id) on delete cascade,
  token_hash     text not null
);
create index if not exists participant_secrets_token on participant_secrets(token_hash);

create table if not exists movies (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  participant_id  uuid references participants(id) on delete set null,
  title           text not null check (char_length(title) between 1 and 200),
  year            int,
  poster          text,
  ext_id          text,
  note            text check (note is null or char_length(note) <= 140),
  created_at      timestamptz not null default now()
);
create unique index if not exists movies_unique_per_event
  on movies (event_id, lower(title), coalesce(year, 0));

alter table events drop constraint if exists events_winner_fk;
alter table events add constraint events_winner_fk
  foreign key (winner_movie_id) references movies(id) on delete set null;

create table if not exists votes (
  movie_id        uuid not null references movies(id) on delete cascade,
  participant_id  uuid not null references participants(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (movie_id, participant_id)
);

create table if not exists date_options (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  day          date not null,
  proposed_by  uuid references participants(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (event_id, day)
);

create table if not exists date_votes (
  date_option_id  uuid not null references date_options(id) on delete cascade,
  participant_id  uuid not null references participants(id) on delete cascade,
  primary key (date_option_id, participant_id)
);

-- private: host key (hash only)
create table if not exists host_settings (
  id        int primary key default 1 check (id = 1),
  key_hash  text not null
);

-- ---------- security: everyone can read, nobody writes directly ----------

grant usage on schema public to anon, authenticated;

alter table events              enable row level security;
alter table participants        enable row level security;
alter table participant_secrets enable row level security;
alter table movies              enable row level security;
alter table votes               enable row level security;
alter table date_options        enable row level security;
alter table date_votes          enable row level security;
alter table host_settings       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['events','participants','movies','votes','date_options','date_votes'] loop
    execute format('drop policy if exists "read all" on %I', t);
    execute format('create policy "read all" on %I for select using (true)', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

revoke all on participant_secrets from anon, authenticated;
revoke all on host_settings       from anon, authenticated;

-- ---------- helpers (internal) ----------

create or replace function _hash(p text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

create or replace function _me(p_event uuid, p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare pid uuid;
begin
  select p.id into pid
    from participants p join participant_secrets s on s.participant_id = p.id
   where p.event_id = p_event and s.token_hash = _hash(p_token);
  if pid is null then raise exception 'not_joined'; end if;
  return pid;
end $$;

create or replace function _require_open(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from events where id = p_event and status = 'open') then
    raise exception 'not_open';
  end if;
end $$;

create or replace function _require_host(p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from host_settings where id = 1 and key_hash = _hash(p_key)) then
    raise exception 'bad_host_key';
  end if;
end $$;

-- keeps only known colour slots with #rrggbb values; null when nothing is left
create or replace function _clean_colors(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'object' then (
    select nullif(coalesce(jsonb_object_agg(key, value), '{}'::jsonb), '{}'::jsonb)
      from jsonb_each(p)
     where key in ('wall','wood','floor','accent','accent2','sofa','paper','ink','rug1','rug2','rug3','glow')
       and jsonb_typeof(value) = 'string' and (value #>> '{}') ~ '^#[0-9a-fA-F]{6}$'
  ) end
$$;

-- keeps only known furniture settings with allowed values; null when nothing is left
create or replace function _clean_room(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'object' then (
    select nullif(coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb), '{}'::jsonb)
      from jsonb_each(p) e
     where jsonb_typeof(e.value) = 'string'
       and coalesce(('{
         "sofa":    ["velvet","leather","plaid","none"],
         "rug":     ["wool","persian","round","none"],
         "lamps":   ["sconces","floor","none"],
         "plants":  ["snake","fern","cactus","none"],
         "plaque":  ["on","off"], "pillows": ["on","off"], "blanket": ["on","off"],
         "window":  ["on","off"], "shelf":   ["on","off"], "record":  ["on","off"],
         "garland": ["on","off"], "chair":   ["on","off"], "popcorn": ["on","off"]
       }'::jsonb -> e.key) ? (e.value #>> '{}'), false)
  ) end
$$;

-- keeps only known text slots, as strings of at most 80 characters ('' means hide it)
create or replace function _clean_texts(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'object' then (
    select nullif(coalesce(jsonb_object_agg(key, to_jsonb(left(btrim(value #>> '{}'), 80))), '{}'::jsonb), '{}'::jsonb)
      from jsonb_each(p)
     where key in ('kicker','plaque','plaque_sub') and jsonb_typeof(value) = 'string'
  ) end
$$;

revoke execute on function _clean_colors(jsonb)     from public, anon, authenticated;
revoke execute on function _clean_texts(jsonb)      from public, anon, authenticated;
revoke execute on function _clean_room(jsonb)       from public, anon, authenticated;
revoke execute on function _me(uuid, text)          from public, anon, authenticated;
revoke execute on function _require_open(uuid)      from public, anon, authenticated;
revoke execute on function _require_host(text)      from public, anon, authenticated;

-- ---------- guest actions ----------

create or replace function join_event(p_event uuid, p_token text, p_nickname text, p_bringing text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; nick text := btrim(p_nickname);
begin
  if char_length(coalesce(p_token,'')) < 16 then raise exception 'bad_token'; end if;
  if nick = '' then raise exception 'nickname_required'; end if;
  if not exists (select 1 from events where id = p_event and status <> 'archived') then
    raise exception 'not_open';
  end if;
  select p.id into pid
    from participants p join participant_secrets s on s.participant_id = p.id
   where p.event_id = p_event and s.token_hash = _hash(p_token);
  if pid is null then
    if (select count(*) from participants where event_id = p_event) >= 40 then
      raise exception 'event_full';
    end if;
    insert into participants(event_id, nickname, bringing)
      values (p_event, left(nick, 24), nullif(left(btrim(coalesce(p_bringing,'')), 60), ''))
      returning id into pid;
    insert into participant_secrets values (pid, _hash(p_token));
  else
    update participants
       set nickname = left(nick, 24),
           bringing = nullif(left(btrim(coalesce(p_bringing,'')), 60), '')
     where id = pid;
  end if;
  return pid;
end $$;

create or replace function add_movie(p_event uuid, p_token text, p_title text, p_year int,
                                     p_poster text default null, p_ext_id text default null,
                                     p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; mid uuid;
begin
  perform _require_open(p_event);
  pid := _me(p_event, p_token);
  if (select count(*) from movies where event_id = p_event and participant_id = pid) >= 3 then
    raise exception 'limit_movies';
  end if;
  if exists (select 1 from movies where event_id = p_event
               and lower(title) = lower(btrim(p_title)) and coalesce(year,0) = coalesce(p_year,0)) then
    raise exception 'duplicate';
  end if;
  if p_poster is not null and p_poster !~ '^https://' then p_poster := null; end if;
  insert into movies(event_id, participant_id, title, year, poster, ext_id, note)
    values (p_event, pid, left(btrim(p_title), 200), p_year, p_poster, p_ext_id,
            nullif(left(btrim(coalesce(p_note,'')), 140), ''))
    returning id into mid;
  return mid;
end $$;

create or replace function remove_movie(p_token text, p_movie uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ev uuid; owner uuid;
begin
  select event_id, participant_id into ev, owner from movies where id = p_movie;
  if ev is null then return; end if;
  perform _require_open(ev);
  if owner is distinct from _me(ev, p_token) then raise exception 'not_yours'; end if;
  delete from movies where id = p_movie;
end $$;

create or replace function toggle_vote(p_token text, p_movie uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare ev uuid; pid uuid;
begin
  select event_id into ev from movies where id = p_movie;
  if ev is null then raise exception 'no_movie'; end if;
  perform _require_open(ev);
  pid := _me(ev, p_token);
  if exists (select 1 from votes where movie_id = p_movie and participant_id = pid) then
    delete from votes where movie_id = p_movie and participant_id = pid;
    return false;
  end if;
  if (select count(*) from votes where event_id = ev and participant_id = pid) >= 5 then
    raise exception 'limit_votes';
  end if;
  insert into votes(movie_id, participant_id, event_id) values (p_movie, pid, ev);
  return true;
end $$;

create or replace function propose_date(p_event uuid, p_token text, p_day date)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid; oid uuid;
begin
  if exists (select 1 from events where id = p_event and final_date is not null) then
    raise exception 'date_locked';
  end if;
  pid := _me(p_event, p_token);
  if p_day < current_date then raise exception 'past_date'; end if;
  select id into oid from date_options where event_id = p_event and day = p_day;
  if oid is null then
    if (select count(*) from date_options where event_id = p_event) >= 20 then
      raise exception 'too_many_dates';
    end if;
    insert into date_options(event_id, day, proposed_by) values (p_event, p_day, pid) returning id into oid;
  end if;
  insert into date_votes values (oid, pid) on conflict do nothing;
  return oid;
end $$;

create or replace function toggle_date(p_token text, p_option uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare ev uuid; pid uuid;
begin
  select event_id into ev from date_options where id = p_option;
  if ev is null then raise exception 'no_date'; end if;
  if exists (select 1 from events where id = ev and final_date is not null) then
    raise exception 'date_locked';
  end if;
  pid := _me(ev, p_token);
  if exists (select 1 from date_votes where date_option_id = p_option and participant_id = pid) then
    delete from date_votes where date_option_id = p_option and participant_id = pid;
    -- drop a date nobody wants anymore
    delete from date_options o where o.id = p_option
       and not exists (select 1 from date_votes v where v.date_option_id = o.id);
    return false;
  end if;
  insert into date_votes values (p_option, pid);
  return true;
end $$;

-- ---------- host actions ----------

-- the first person to open /#/host and pick a key becomes the host.
create or replace function host_claim(p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_key,'')) < 6 then raise exception 'key_too_short'; end if;
  if exists (select 1 from host_settings) then
    return exists (select 1 from host_settings where key_hash = _hash(p_key));
  end if;
  insert into host_settings(id, key_hash) values (1, _hash(p_key));
  return true;
end $$;

create or replace function host_has_key()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from host_settings)
$$;

create or replace function host_update_event(p_key text, p_event uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_host(p_key);
  update events set
    title           = coalesce(p_patch->>'title', title),
    tagline         = case when p_patch ? 'tagline'    then nullif(p_patch->>'tagline','')    else tagline end,
    theme           = coalesce(p_patch->>'theme', theme),
    colors          = case when p_patch ? 'colors'     then _clean_colors(p_patch->'colors') else colors end,
    room            = case when p_patch ? 'room'       then _clean_room(p_patch->'room')     else room end,
    texts           = case when p_patch ? 'texts'      then _clean_texts(p_patch->'texts')   else texts end,
    location        = case when p_patch ? 'location'   then nullif(p_patch->>'location','')   else location end,
    bring           = case when p_patch ? 'bring'      then nullif(p_patch->>'bring','')      else bring end,
    final_date      = case when p_patch ? 'final_date' then nullif(p_patch->>'final_date','')::date else final_date end,
    final_time      = case when p_patch ? 'final_time' then nullif(p_patch->>'final_time','') else final_time end,
    status          = case when p_patch->>'status' in ('open','locked') then p_patch->>'status' else status end,
    winner_movie_id = case when p_patch ? 'winner_movie_id'
                           then nullif(p_patch->>'winner_movie_id','')::uuid else winner_movie_id end
  where id = p_event and status <> 'archived';
end $$;

create or replace function host_remove_movie(p_key text, p_movie uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_host(p_key);
  delete from movies where id = p_movie;
end $$;

-- closes the current night (winner = most tickets unless picked) and opens the next one
create or replace function host_archive_and_new(p_key text, p_event uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare e events; new_id uuid; top uuid;
begin
  perform _require_host(p_key);
  select * into e from events where id = p_event;
  if e.id is null or e.status = 'archived' then raise exception 'not_open'; end if;
  if e.winner_movie_id is null then
    select m.id into top from movies m left join votes v on v.movie_id = m.id
     where m.event_id = p_event group by m.id, m.created_at
     order by count(v.*) desc, m.created_at asc limit 1;
  end if;
  update events set status = 'archived', archived_at = now(),
         winner_movie_id = coalesce(winner_movie_id, top)
   where id = p_event;
  insert into events(number, title, theme, colors, room, texts, location, bring)
    values (e.number + 1, 'movie night no. ' || (e.number + 1), e.theme, e.colors, e.room, e.texts, e.location, e.bring)
    returning id into new_id;
  return new_id;
end $$;

grant execute on function join_event(uuid, text, text, text)                  to anon, authenticated;
grant execute on function add_movie(uuid, text, text, int, text, text, text)  to anon, authenticated;
grant execute on function remove_movie(text, uuid)                            to anon, authenticated;
grant execute on function toggle_vote(text, uuid)                             to anon, authenticated;
grant execute on function propose_date(uuid, text, date)                      to anon, authenticated;
grant execute on function toggle_date(text, uuid)                             to anon, authenticated;
grant execute on function host_claim(text)                                    to anon, authenticated;
grant execute on function host_has_key()                                      to anon, authenticated;
grant execute on function host_update_event(text, uuid, jsonb)                to anon, authenticated;
grant execute on function host_remove_movie(text, uuid)                       to anon, authenticated;
grant execute on function host_archive_and_new(text, uuid)                    to anon, authenticated;

-- ---------- live updates ----------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['events','participants','movies','votes','date_options','date_votes'] loop
      begin
        execute format('alter publication supabase_realtime add table %I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- ---------- the first night ----------

insert into events (number, title, tagline, theme, location, bring)
select 1, 'movie night no. 1',
       'films that widen the world a little, watched by people who make it warmer.',
       'moss', 'upper room, life church', 'snacks & a blanket'
where not exists (select 1 from events);
