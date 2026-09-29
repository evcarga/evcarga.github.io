-- EvCar: anuncios, administración y endurecimiento de RLS (aplicado 2026-09-29)

-- ================= ANUNCIOS =================
-- kind = 'popup' (flotante a los 5 s) | 'fixed' (banner fijo en la web)
create table if not exists public.ads (
  id bigint generated always as identity primary key,
  kind text not null default 'fixed' check (kind in ('popup','fixed')),
  title text not null,
  body text,
  button_text text,
  link_url text,
  image_url text,
  active boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ads enable row level security;

drop policy if exists ads_select on public.ads;
create policy ads_select on public.ads for select using (active or public.is_admin());
drop policy if exists ads_admin_insert on public.ads;
create policy ads_admin_insert on public.ads for insert with check (public.is_admin());
drop policy if exists ads_admin_update on public.ads;
create policy ads_admin_update on public.ads for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists ads_admin_delete on public.ads;
create policy ads_admin_delete on public.ads for delete using (public.is_admin());

-- Anuncio flotante de instalación de cargadores (activable desde admin.html)
insert into public.ads (kind, title, body, button_text, link_url, active)
select 'popup',
       '¿Necesitas instalar un cargador para tu carro eléctrico?',
       'Instalación profesional de cargadores para autos eléctricos en tu casa o negocio desde $20 USD.',
       'Cotizar por WhatsApp',
       'https://wa.me/593980407829?text=Hola,%20quiero%20cotizar%20la%20instalaci%C3%B3n%20de%20un%20cargador%20para%20mi%20carro%20el%C3%A9ctrico',
       true
where not exists (select 1 from public.ads where kind = 'popup');

-- ================= ADMIN: USUARIOS =================
create or replace function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, provider text,
               created_at timestamptz, last_sign_in_at timestamptz, chargers_count bigint)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  return query
    select u.id, u.email::text, p.full_name, p.phone, coalesce(p.role,'user'),
           coalesce(u.raw_app_meta_data->>'provider','email'),
           u.created_at, u.last_sign_in_at,
           (select count(*) from public.chargers c where c.user_id = u.id)
    from auth.users u left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  if p_role not in ('user','admin') then raise exception 'Rol inválido'; end if;
  if p_user = auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
  update public.profiles set role = p_role where id = p_user;
end $$;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- El trigger anti-escalada ahora deja pasar a los admins
create or replace function public.prevent_role_self_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    NEW.role := OLD.role;
  END IF;
  RETURN NEW;
END;
$$;

-- ================= ENDURECIMIENTO RLS =================
-- Permitía a cualquiera insertar perfiles arbitrarios (el trigger handle_new_user ya los crea)
drop policy if exists "Sistema inserta perfil" on public.profiles;
-- Exponía teléfonos de todos los usuarios a visitantes anónimos; queda profiles_select (solo autenticados)
drop policy if exists "Ver perfiles" on public.profiles;
-- Duplicadas de chargers_insert / chargers_update (sin la excepción de admin)
drop policy if exists "Crear cargadores" on public.chargers;
drop policy if exists "Editar cargadores" on public.chargers;

-- ================= RESTRICCIÓN POR ORIGEN =================
-- Rechaza peticiones REST con la anon key (o de usuarios) a las tablas de EvCar
-- que no vengan del navegador en https://evcarga.github.io
-- Nota: el header Origin puede falsificarse fuera del navegador; la seguridad real es RLS.
create or replace function public.check_request_origin()
returns void language plpgsql as $$
declare
  hdrs json := nullif(current_setting('request.headers', true), '')::json;
  path text := coalesce(current_setting('request.path', true), '');
  origin text := coalesce(hdrs->>'origin', '');
begin
  if current_user not in ('anon', 'authenticated') then return; end if;
  if path !~ '^/(chargers|profiles|ads|rpc/admin_)' then return; end if;
  if origin <> 'https://evcarga.github.io' then
    raise exception 'Origen no permitido' using errcode = '42501';
  end if;
end $$;
grant execute on function public.check_request_origin() to anon, authenticated;
alter role authenticator set pgrst.db_pre_request = 'public.check_request_origin';
notify pgrst, 'reload config';
