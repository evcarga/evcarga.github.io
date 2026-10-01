-- Marketplace: la descripción es pública (para compartir en WhatsApp); el teléfono sigue solo para registrados
grant select (id, kind, category, title, price, description, city, images, is_company, company_name, status, created_at)
  on public.market_listings to anon;
