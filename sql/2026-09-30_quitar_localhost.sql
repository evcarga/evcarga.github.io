-- Publicado: se quita el origen temporal localhost:4321
create or replace function public.check_request_origin()
returns void language plpgsql as $$
declare
  hdrs json := nullif(current_setting('request.headers', true), '')::json;
  path text := coalesce(current_setting('request.path', true), '');
  origin text := coalesce(hdrs->>'origin', '');
begin
  if current_user not in ('anon', 'authenticated') then return; end if;
  if path !~ '^/(chargers|profiles|ads|page_visits|charger_reports|market_listings|faq|community_posts|rpc/admin_)' then return; end if;
  if origin <> 'https://evcarga.github.io' then
    raise exception 'Origen no permitido' using errcode = '42501';
  end if;
end $$;
