// Datos de cargadores para generar las páginas por ciudad (se ejecuta al construir el sitio)
const SUPABASE_URL = 'https://yjnlfewsgksdsvsimdjs.supabase.co';
// Clave anon pública (la misma del frontend); la seguridad está en RLS
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqbmxmZXdzZ2tzZHN2c2ltZGpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3NTk4OTgsImV4cCI6MjA3OTMzNTg5OH0.ysDsAdyn3k2i51xnAkJFGKtEWpQ3laxWV7rpjvFIF8E';

export function slugify(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

let cache = null;
export async function getChargers() {
  if (cache) return cache;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chargers?select=id,title,city,provincia,address,charger_type,power,price_kwh,price_parking,parking_type,schedule,lat,lng,link,status&country=eq.EC&order=title`, {
    // La base solo acepta peticiones con el origen del sitio
    headers: { apikey: SUPABASE_KEY, Origin: 'https://evcarga.github.io' },
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  cache = await res.json();
  return cache;
}

// Agrupa por ciudad normalizada; el nombre visible es la variante más común
export async function getCities() {
  const groups = new Map();
  for (const c of await getChargers()) {
    const slug = slugify(c.city);
    if (!slug) continue;
    if (!groups.has(slug)) groups.set(slug, { slug, names: {}, provincias: {}, chargers: [] });
    const g = groups.get(slug);
    const name = c.city.trim();
    g.names[name] = (g.names[name] || 0) + 1;
    if (c.provincia) g.provincias[c.provincia] = (g.provincias[c.provincia] || 0) + 1;
    g.chargers.push(c);
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return [...groups.values()]
    .map((g) => ({ slug: g.slug, name: top(g.names), provincia: top(g.provincias), chargers: g.chargers }))
    .sort((a, b) => b.chargers.length - a.chargers.length || a.name.localeCompare(b.name));
}

// Potencia máxima en kW que aparece en el texto (ej. "7 kW / 60 kW" -> 60)
export function maxKw(power) {
  const nums = [...(power || '').matchAll(/(\d+(?:[.,]\d+)?)\s*kw/gi)].map((m) => parseFloat(m[1].replace(',', '.')));
  return nums.length ? Math.max(...nums) : null;
}
