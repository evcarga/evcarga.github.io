-- EvCar: registro de aceptación de Política de Privacidad y Términos
alter table public.profiles add column if not exists terms_accepted_at timestamptz;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, consent_email, consent_whatsapp, consent_updated_at, terms_accepted_at)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'phone',
    coalesce((new.raw_user_meta_data->>'consent_email')::boolean, false),
    coalesce((new.raw_user_meta_data->>'consent_whatsapp')::boolean, false),
    case when new.raw_user_meta_data ? 'consent_email' then now() end,
    case when (new.raw_user_meta_data->>'terms_accepted')::boolean then now() end
  );
  RETURN new;
END;
$$;
