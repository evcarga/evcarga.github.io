-- EvCar: el teléfono de contacto de un cargador solo lo ven usuarios registrados
revoke select on public.chargers from anon;
grant select (id, user_id, title, city, address, charger_type, power, price_kwh, price_parking, parking_type,
              schedule, lat, lng, status, occupied_until, created_at, link, provincia, region, requires_app,
              community_only)
  on public.chargers to anon;
