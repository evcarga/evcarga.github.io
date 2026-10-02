// Regenera el sitio (GitHub Actions) al aprobar o editar publicaciones, para que su página
// /p/<id>.html con vista previa de WhatsApp exista de inmediato. Solo administradores.
// El token de GitHub va en el secreto GITHUB_DISPATCH_TOKEN, nunca en el frontend.

const ALLOWED_ORIGINS = ['https://evcarga.github.io'];
const REPO = 'evcarga/evcarga.github.io';
const WORKFLOW = 'deploy.yml';

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

// Evita disparar varias regeneraciones seguidas (mejor esfuerzo por instancia)
let lastDispatch = 0;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Origen no permitido', { status: 403 });
  const headers = { ...cors(origin), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  // Verifica que quien llama es un administrador (con su sesión de Supabase)
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('authorization') || '';
  const userRes = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } });
  if (!userRes.ok) return reply({ error: 'Sesión no válida' }, 401);
  const user = await userRes.json();
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const profRes = await fetch(`${url}/rest/v1/profiles?select=role&id=eq.${user.id}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  const role = (await profRes.json())?.[0]?.role;
  if (role !== 'admin') return reply({ error: 'Solo administradores' }, 403);

  if (Date.now() - lastDispatch < 60 * 1000) return reply({ ok: true, skipped: 'Ya hay una regeneración en curso' });

  const gh = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('GITHUB_DISPATCH_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'evcarga-rebuild',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (gh.status !== 204) {
    console.error('GitHub', gh.status, (await gh.text()).slice(0, 300));
    return reply({ error: 'No se pudo regenerar el sitio' }, 502);
  }
  lastDispatch = Date.now();
  return reply({ ok: true });
});
