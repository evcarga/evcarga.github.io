// Asistente EV: responde con la base de preguntas frecuentes (tabla faq) y, si no aplica, de forma libre.
// Usa Groq (modelo openai/gpt-oss-20b). La clave va en el secreto GROQ_API_KEY, nunca en el frontend.
// Para no agotar el límite gratuito de Groq (8.000 tokens/min): solo se envían las FAQ relacionadas,
// las preguntas exactas de la FAQ se responden sin IA y las respuestas se guardan en memoria.

const ALLOWED_ORIGINS = ['https://evcarga.github.io'];
const MODEL = 'openai/gpt-oss-20b';

type Faq = { id: number; q: string; a: string; k: string | null };

// Límite simple por IP (mejor esfuerzo: se reinicia con cada instancia)
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['que', 'como', 'cual', 'para', 'con', 'los', 'las', 'del', 'una', 'uno', 'por', 'mas', 'hay', 'donde', 'cuanto', 'cuanta', 'tengo', 'puedo', 'mi', 'el', 'la', 'es', 'se', 'me', 'de', 'en', 'y', 'o', 'un']);
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

// FAQ en memoria (5 min) para no consultarla en cada pregunta
let faqCache: { at: number; list: Faq[] } | null = null;
async function loadFaq(): Promise<Faq[]> {
  if (faqCache && Date.now() - faqCache.at < 5 * 60 * 1000) return faqCache.list;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${url}/rest/v1/faq?select=id,q,a,k&order=sort_order`, {
    headers: { apikey: key!, Authorization: `Bearer ${key}` },
  });
  const list = res.ok ? await res.json() : [];
  faqCache = { at: Date.now(), list };
  return list;
}

// Puntaje por palabras en común (pregunta + palabras clave pesan más que la respuesta)
function rank(question: string, faq: Faq[]) {
  const qw = words(question);
  return faq
    .map((f) => {
      const head = new Set(words(f.q + ' ' + (f.k || '')));
      const body = new Set(words(f.a));
      let s = 0;
      for (const w of qw) {
        if (head.has(w) || [...head].some((h) => h.length > 4 && (h.startsWith(w) || w.startsWith(h)))) s += 2;
        else if (body.has(w)) s += 1;
      }
      return { f, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
}

// Respuestas recientes en memoria (1 h)
const answerCache = new Map<string, { at: number; body: unknown }>();

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Origen no permitido', { status: 403 });
  const headers = { ...cors(origin), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  let question = '';
  try { question = String((await req.json()).question || '').trim().slice(0, 500); } catch { /* cuerpo inválido */ }
  if (question.length < 3) return reply({ error: 'Escribe una pregunta.' }, 400);

  const faq = await loadFaq();
  const key = norm(question);

  // 1) Pregunta idéntica a una de la FAQ: respuesta directa, sin IA
  const exact = faq.find((f) => norm(f.q) === key);
  if (exact) return reply({ answer: exact.a, from_faq: true, related: [{ id: exact.id, q: exact.q }] });

  // 2) Respuesta ya dada hace poco
  const cached = answerCache.get(key);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return reply(cached.body);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'desconocido';
  if (rateLimited(ip)) return reply({ error: 'Demasiadas preguntas seguidas. Intenta en unos minutos.' }, 429);

  // 3) Solo las FAQ relacionadas (máx. 4) van a la IA
  const ranked = rank(question, faq);
  const top = ranked.slice(0, 4).map((x) => x.f);
  const base = top.length ? top.map((f) => `[${f.id}] P: ${f.q}\nR: ${f.a}`).join('\n\n') : '(ninguna relacionada)';

  const system = `Eres el asistente de EvCarga Ecuador, comunidad de dueños de autos eléctricos en Ecuador.
Responde SIEMPRE en español, claro y breve (máximo 5 frases), sin inventar precios ni teléfonos.
Preguntas frecuentes de la comunidad posiblemente relacionadas:

${base}

- Si alguna responde la pregunta, úsala y empieza con la línea "FAQ: <ids separados por coma>".
- Si ninguna aplica, responde con conocimiento general sobre autos eléctricos (sobre todo en Ecuador), empieza con "FAQ: ninguna" y aclara que es una respuesta general.
- Si la pregunta no trata de autos eléctricos, carga o movilidad, di amablemente que solo respondes esos temas.`;

  const groq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_completion_tokens: 450,
      reasoning_effort: 'low',
      messages: [{ role: 'system', content: system }, { role: 'user', content: question }],
    }),
  });

  if (!groq.ok) {
    console.error('Groq', groq.status, (await groq.text()).slice(0, 300));
    // Respaldo: la FAQ más parecida, para no dejar al usuario sin respuesta
    if (ranked.length) {
      const f = ranked[0].f;
      return reply({ answer: f.a, from_faq: true, related: [{ id: f.id, q: f.q }], fallback: true });
    }
    const busy = groq.status === 429;
    return reply({ error: busy ? 'El asistente está atendiendo muchas preguntas. Intenta de nuevo en un minuto.' : 'El asistente no está disponible ahora. Intenta más tarde.' }, busy ? 429 : 502);
  }

  const data = await groq.json();
  let text: string = data.choices?.[0]?.message?.content?.trim() || '';
  let matched: number[] = [];
  const m = text.match(/^FAQ:\s*([^\n]*)\n?/i);
  if (m) {
    matched = (m[1].match(/\d+/g) || []).map(Number).filter((id) => faq.some((f) => f.id === id));
    text = text.slice(m[0].length).trim();
  }
  if (!text) {
    if (ranked.length) { const f = ranked[0].f; return reply({ answer: f.a, from_faq: true, related: [{ id: f.id, q: f.q }], fallback: true }); }
    return reply({ error: 'No pude generar una respuesta. Intenta con otras palabras.' }, 502);
  }
  const related = faq.filter((f) => matched.includes(f.id)).map((f) => ({ id: f.id, q: f.q }));
  const body = { answer: text, from_faq: related.length > 0, related };
  answerCache.set(key, { at: Date.now(), body });
  if (answerCache.size > 300) answerCache.delete(answerCache.keys().next().value!);
  return reply(body);
});
