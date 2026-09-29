-- EvCar: registro anónimo de visitas (sin IP) y estadísticas para admin
create table if not exists public.page_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  path text check (char_length(path) <= 200),
  referrer text check (char_length(referrer) <= 300),
  visitor_id text check (char_length(visitor_id) <= 64),
  device text check (device in ('mobile','desktop')),
  user_id uuid default auth.uid()
);
create index if not exists page_visits_created_idx on public.page_visits (created_at);
alter table public.page_visits enable row level security;

-- Cualquiera registra su visita (user_id solo puede ser el propio o vacío); solo admin lee
drop policy if exists visits_insert on public.page_visits;
create policy visits_insert on public.page_visits for insert
  with check (user_id is null or user_id = auth.uid());
drop policy if exists visits_admin_select on public.page_visits;
create policy visits_admin_select on public.page_visits for select using (public.is_admin());

create or replace function public.admin_visit_stats(p_days int default 30)
returns json language plpgsql security definer set search_path = public as $$
declare since timestamptz := date_trunc('day', now() at time zone 'America/Guayaquil') at time zone 'America/Guayaquil' - make_interval(days => greatest(p_days,1) - 1);
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'today', (select count(*) from page_visits where created_at >= date_trunc('day', now() at time zone 'America/Guayaquil') at time zone 'America/Guayaquil'),
    'total', (select count(*) from page_visits where created_at >= since),
    'unique', (select count(distinct visitor_id) from page_visits where created_at >= since),
    'mobile', (select count(*) from page_visits where created_at >= since and device = 'mobile'),
    'logged', (select count(*) from page_visits where created_at >= since and user_id is not null),
    'by_day', (select coalesce(json_agg(json_build_object('day', d::date, 'visits', coalesce(v.n,0), 'unique', coalesce(v.u,0)) order by d), '[]')
               from generate_series(since at time zone 'America/Guayaquil', now() at time zone 'America/Guayaquil', interval '1 day') d
               left join (select (created_at at time zone 'America/Guayaquil')::date as dia, count(*) n, count(distinct visitor_id) u
                          from page_visits where created_at >= since group by 1) v on v.dia = d::date),
    'referrers', (select coalesce(json_agg(r), '[]') from (
                    select coalesce(nullif(split_part(split_part(referrer,'://',2),'/',1),''),'Directo') source, count(*) visits
                    from page_visits where created_at >= since group by 1 order by 2 desc limit 10) r)
  );
end $$;
revoke all on function public.admin_visit_stats(int) from public, anon;
grant execute on function public.admin_visit_stats(int) to authenticated;

-- Incluir la tabla en la restricción por origen
create or replace function public.check_request_origin()
returns void language plpgsql as $$
declare
  hdrs json := nullif(current_setting('request.headers', true), '')::json;
  path text := coalesce(current_setting('request.path', true), '');
  origin text := coalesce(hdrs->>'origin', '');
begin
  if current_user not in ('anon', 'authenticated') then return; end if;
  if path !~ '^/(chargers|profiles|ads|page_visits|rpc/admin_)' then return; end if;
  if origin <> 'https://evcarga.github.io' then
    raise exception 'Origen no permitido' using errcode = '42501';
  end if;
end $$;
