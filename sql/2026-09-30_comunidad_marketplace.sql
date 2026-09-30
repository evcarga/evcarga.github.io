-- EvCar: reportes de cargadores, marketplace con aprobación, FAQ y aportes de la comunidad (2026-09-30)

-- ================= REPORTES DE NOVEDADES EN CARGADORES =================
create table if not exists public.charger_reports (
  id bigint generated always as identity primary key,
  charger_id bigint not null references public.chargers(id) on delete cascade,
  user_id uuid default auth.uid(),
  kind text not null check (kind in ('no_funciona','info_incorrecta','precio','horario','ya_no_existe','otro')),
  message text check (char_length(message) <= 1000),
  status text not null default 'nuevo' check (status in ('nuevo','revisado')),
  created_at timestamptz not null default now()
);
alter table public.charger_reports enable row level security;
drop policy if exists reports_insert on public.charger_reports;
create policy reports_insert on public.charger_reports for insert
  with check ((user_id is null or user_id = auth.uid()) and status = 'nuevo');
drop policy if exists reports_admin_select on public.charger_reports;
create policy reports_admin_select on public.charger_reports for select using (public.is_admin());
drop policy if exists reports_admin_update on public.charger_reports;
create policy reports_admin_update on public.charger_reports for update using (public.is_admin());
drop policy if exists reports_admin_delete on public.charger_reports;
create policy reports_admin_delete on public.charger_reports for delete using (public.is_admin());

-- ================= MARKETPLACE =================
create table if not exists public.market_listings (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null default 'producto' check (kind in ('producto','servicio')),
  category text not null check (char_length(category) <= 40),
  title text not null check (char_length(title) between 3 and 120),
  price numeric(12,2) check (price is null or price >= 0),
  description text check (char_length(description) <= 3000),
  city text check (char_length(city) <= 80),
  images text[] not null default '{}' check (cardinality(images) <= 6),
  is_company boolean not null default false,
  company_name text check (char_length(company_name) <= 80),
  share_phone boolean not null default false,
  contact_phone text check (char_length(contact_phone) <= 20),
  status text not null default 'pendiente' check (status in ('pendiente','aprobado','rechazado')),
  admin_note text check (char_length(admin_note) <= 300),
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists market_status_idx on public.market_listings (status, created_at desc);
alter table public.market_listings enable row level security;

-- Solo el admin aprueba; si el dueño edita, vuelve a revisión. Sin permiso de compartir, no se guarda teléfono.
create or replace function public.market_listing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status := 'pendiente';
    new.admin_note := null;
    new.is_seed := false;
    if tg_op = 'UPDATE' then new.user_id := old.user_id; end if;
  end if;
  if not new.share_phone then new.contact_phone := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_market_guard on public.market_listings;
create trigger trg_market_guard before insert or update on public.market_listings
  for each row execute function public.market_listing_guard();

drop policy if exists market_select on public.market_listings;
create policy market_select on public.market_listings for select
  using (status = 'aprobado' or user_id = auth.uid() or public.is_admin());
drop policy if exists market_insert on public.market_listings;
create policy market_insert on public.market_listings for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists market_update on public.market_listings;
create policy market_update on public.market_listings for update to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists market_delete on public.market_listings;
create policy market_delete on public.market_listings for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Visitantes sin cuenta: solo imagen, título, precio y datos básicos (sin descripción ni contacto)
revoke select on public.market_listings from anon;
grant select (id, kind, category, title, price, city, images, is_company, company_name, status, created_at)
  on public.market_listings to anon;

-- Imágenes del marketplace (solo .webp, máx. 1 MB, cada usuario en su carpeta)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market', 'market', true, 1048576, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp'];

drop policy if exists market_img_insert on storage.objects;
create policy market_img_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'market' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists market_img_delete on storage.objects;
create policy market_img_delete on storage.objects for delete to authenticated
  using (bucket_id = 'market' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ================= FAQ (base del asistente) =================
create table if not exists public.faq (
  id bigint generated always as identity primary key,
  q text not null,
  a text not null,
  k text,
  sort_order int not null default 0
);
alter table public.faq enable row level security;
drop policy if exists faq_select on public.faq;
create policy faq_select on public.faq for select using (true);
drop policy if exists faq_admin on public.faq;
create policy faq_admin on public.faq for all using (public.is_admin()) with check (public.is_admin());

-- ================= APORTES DE LA COMUNIDAD (autonomías y viajes) =================
create table if not exists public.community_posts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('autonomia','viaje')),
  data jsonb not null check (pg_column_size(data) <= 2000),
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.community_posts enable row level security;
drop policy if exists cposts_select on public.community_posts;
create policy cposts_select on public.community_posts for select using (true);
drop policy if exists cposts_insert on public.community_posts;
create policy cposts_insert on public.community_posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists cposts_delete on public.community_posts;
create policy cposts_delete on public.community_posts for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- ================= ORIGEN PERMITIDO =================
-- TEMPORAL: localhost:4321 para revisar en local antes de publicar (quitar al publicar)
create or replace function public.check_request_origin()
returns void language plpgsql as $$
declare
  hdrs json := nullif(current_setting('request.headers', true), '')::json;
  path text := coalesce(current_setting('request.path', true), '');
  origin text := coalesce(hdrs->>'origin', '');
begin
  if current_user not in ('anon', 'authenticated') then return; end if;
  if path !~ '^/(chargers|profiles|ads|page_visits|charger_reports|market_listings|faq|community_posts|rpc/admin_)' then return; end if;
  if origin not in ('https://evcarga.github.io', 'http://localhost:4321') then
    raise exception 'Origen no permitido' using errcode = '42501';
  end if;
end $$;

-- ================= CARGADORES NO DISPONIBLES =================
-- Condor en Quito: fuera de servicio por el momento
update public.chargers set status = 'NO DISPONIBLE', occupied_until = null
where id in (1074, 879, 883, 889, 900, 901, 906);
