// Publicaciones aprobadas del marketplace (se usan al construir el sitio: páginas para compartir)
const SUPABASE_URL = 'https://yjnlfewsgksdsvsimdjs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqbmxmZXdzZ2tzZHN2c2ltZGpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3NTk4OTgsImV4cCI6MjA3OTMzNTg5OH0.ysDsAdyn3k2i51xnAkJFGKtEWpQ3laxWV7rpjvFIF8E'; // clave anon pública; el teléfono no es accesible con ella

let cache = null;
export async function getApprovedListings() {
  if (cache) return cache;
  const cols = 'id,kind,category,title,price,description,city,images,is_company,company_name,created_at';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/market_listings?select=${cols}&status=eq.aprobado&order=created_at.desc`, {
    headers: { apikey: SUPABASE_KEY, Origin: 'https://evcarga.github.io' },
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  cache = await res.json();
  return cache;
}

export const priceText = (p) => (p == null ? 'A convenir' : '$' + Number(p).toLocaleString('es-EC', { maximumFractionDigits: 2 }));
