-- EvCar: consentimiento para recibir información por correo / WhatsApp (LOPDP)
alter table public.profiles
  add column if not exists consent_email boolean not null default false,
  add column if not exists consent_whatsapp boolean not null default false,
  add column if not exists consent_updated_at timestamptz;

-- Guarda el consentimiento elegido al registrarse (viene en los metadatos del signUp)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, consent_email, consent_whatsapp, consent_updated_at)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    coalesce((new.raw_user_meta_data->>'consent_email')::boolean, false),
    coalesce((new.raw_user_meta_data->>'consent_whatsapp')::boolean, false),
    case when new.raw_user_meta_data ? 'consent_email' then now() end
  );
  RETURN new;
END;
$$;

-- admin_list_users ahora incluye el consentimiento
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, provider text,
               created_at timestamptz, last_sign_in_at timestamptz, chargers_count bigint,
               consent_email boolean, consent_whatsapp boolean, consent_updated_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Solo administradores'; end if;
  return query
    select u.id, u.email::text, p.full_name, p.phone, coalesce(p.role,'user'),
           coalesce(u.raw_app_meta_data->>'provider','email'),
           u.created_at, u.last_sign_in_at,
           (select count(*) from public.chargers c where c.user_id = u.id),
           coalesce(p.consent_email,false), coalesce(p.consent_whatsapp,false), p.consent_updated_at
    from auth.users u left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
