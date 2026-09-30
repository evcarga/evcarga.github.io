// Sitemap generado al construir: páginas principales + una por ciudad
import { getCities } from '../lib/chargers.js';

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const base = 'https://evcarga.github.io';
  const urls = [
    { loc: `${base}/`, freq: 'daily', pri: '1.0' },
    { loc: `${base}/cargadores.html`, freq: 'daily', pri: '0.8' },
    { loc: `${base}/entorno.html`, freq: 'daily', pri: '0.8' },
    ...(await getCities()).map((c) => ({ loc: `${base}/cargadores/${c.slug}.html`, freq: 'weekly', pri: '0.7' })),
    { loc: `${base}/privacidad.html`, freq: 'yearly', pri: '0.3' },
  ];
  const body = urls
    .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`)
    .join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
