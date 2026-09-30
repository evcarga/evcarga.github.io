// Asistente EV: responde con la base de preguntas frecuentes (tabla faq) y, si no aplica, de forma libre.
// Usa Groq (modelo openai/gpt-oss-20b). La clave va en el secreto GROQ_API_KEY, nunca en el frontend.

const ALLOWED_ORIGINS = ['https://evcarga.github.io'];
const MODEL = 'openai/gpt-oss-20b';

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

async function loadFaq() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${url}/rest/v1/faq?select=id,q,a&order=sort_order`, {
    headers: { apikey: key!, Authorization: `Bearer ${key}` },
  });
  return res.ok ? await res.json() : [];
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Origen no permitido', { status: 403 });
  const headers = { ...cors(origin), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'desconocido';
  if (rateLimited(ip)) return new Response(JSON.stringify({ error: 'Demasiadas preguntas seguidas. Intenta en unos minutos.' }), { status: 429, headers });

  let question = '';
  try { question = String((await req.json()).question || '').trim().slice(0, 500); } catch { /* cuerpo inválido */ }
  if (question.length < 3) return new Response(JSON.stringify({ error: 'Escribe una pregunta.' }), { status: 400, headers });

  const faq = await loadFaq();
  const base = faq.map((f: { id: number; q: string; a: string }) => `[${f.id}] P: ${f.q}\nR: ${f.a}`).join('\n\n');

  const system = `Eres el asistente de EvCarga Ecuador, comunidad de dueños de autos eléctricos en Ecuador.
Responde SIEMPRE en español, claro y breve (máximo 6 frases), sin inventar precios ni teléfonos.
Tienes esta base de preguntas frecuentes de la comunidad:

${base}

Instrucciones:
- Si la pregunta del usuario coincide o se relaciona con una o más preguntas de la base, responde usando esa información y comienza tu respuesta con la línea "FAQ: <ids separados por coma>".
- Si no hay ninguna relacionada, responde con tu conocimiento general sobre autos eléctricos (especialmente en Ecuador) y comienza con la línea "FAQ: ninguna". Aclara que es una respuesta general y que conviene verificar.
- Si la pregunta no tiene relación con autos eléctricos, carga, movilidad o la web, indica amablemente que solo respondes sobre esos temas.`;

  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: 0.3,
    max_completion_tokens: 900,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
  };

  const groq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!groq.ok) {
    console.error('Groq', groq.status, await groq.text());
    return new Response(JSON.stringify({ error: 'El asistente no está disponible ahora. Intenta más tarde.' }), { status: 502, headers });
  }
  const data = await groq.json();
  let text: string = data.choices?.[0]?.message?.content?.trim() || '';

  // Separar la línea "FAQ: ..." del texto
  let matched: number[] = [];
  const m = text.match(/^FAQ:\s*([^\n]*)\n?/i);
  if (m) {
    matched = (m[1].match(/\d+/g) || []).map(Number).filter((id) => faq.some((f: { id: number }) => f.id === id));
    text = text.slice(m[0].length).trim();
  }
  const related = faq.filter((f: { id: number }) => matched.includes(f.id)).map((f: { id: number; q: string }) => ({ id: f.id, q: f.q }));

  return new Response(JSON.stringify({ answer: text, from_faq: related.length > 0, related }), { headers });
});
