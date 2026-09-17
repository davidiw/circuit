import { Hono, type Context, type Next } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { integrityProblems } from '../src/model/integrity';
import { Project } from '../src/model/schema';
import { registry } from '../src/data';
import { loadAi, type Provider } from './ai-stub';
import { loadDotEnv } from './env';

// ---------- Config ----------
loadDotEnv();                       // .env in the working directory, git-ignored; never overrides variables already set
const env = process.env;
if (PROD_CHECK(env) && (!env.GATE_USER || !env.GATE_PASS)) throw new Error('GATE_USER and GATE_PASS are required in production');
const PROD = env.NODE_ENV === 'production';
function PROD_CHECK(e: NodeJS.ProcessEnv) { return e.NODE_ENV === 'production'; }
export const config = {
  port: Number(env.PORT ?? 8797),
  sessionSecret: env.SESSION_SECRET ?? (() => {
    if (PROD) throw new Error('SESSION_SECRET is required in production');
    console.warn('[circuit] SESSION_SECRET not set; using a random per-process secret (development only)');
    return randomBytes(32).toString('hex');
  })(),
  gateUser: env.GATE_USER ?? '',
  gatePass: env.GATE_PASS ?? '',
  aiHourlyLimit: Number(env.AI_HOURLY_LIMIT ?? 30),
  aiDailyCap: Number(env.AI_DAILY_CAP ?? 500),
  distDir: env.DIST_DIR ?? 'dist',
};

const commit = env.COMMIT_SHA ?? (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; } })();

const ai = await loadAi();
let provider: Provider | null = null;
try { provider = ai.createProviderFromEnv(env); } catch (e) { console.warn('[circuit] AI provider not configured:', (e as Error).message); }
export function setProvider(p: Provider | null) { provider = p; }

// ---------- Session cookie ----------
const COOKIE = 'cf_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const sign = (s: string) => createHmac('sha256', config.sessionSecret).update(s).digest('hex');
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export function mintSession(now = Date.now()) { const ts = String(now); return `${ts}.${sign(ts)}`; }
export function validSession(v: string | undefined, now = Date.now()) {
  if (!v) return false;
  const i = v.indexOf('.'); if (i < 0) return false;
  const ts = v.slice(0, i), sig = v.slice(i + 1);
  if (!/^\d+$/.test(ts) || !safeEq(sig, sign(ts))) return false;
  const issued = Number(ts);
  return now - issued >= 0 && now - issued < SESSION_MS;
}

// ---------- Rate limits (in memory) ----------
class Window { private hits = new Map<string, number[]>(); constructor(private limit: number, private ms: number) {}
  hit(key: string, now = Date.now()) { const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms); arr.push(now); this.hits.set(key, arr); return arr.length <= this.limit; }
  reset() { this.hits.clear(); } }
export const loginLimiter = new Window(10, 60_000);
export const aiSessionLimiter = new Window(config.aiHourlyLimit, 3_600_000);
const daily = { day: '', count: 0 };
function dailyOk() { const d = new Date().toISOString().slice(0, 10); if (daily.day !== d) { daily.day = d; daily.count = 0; } return ++daily.count <= config.aiDailyCap; }
export function resetLimits() { loginLimiter.reset(); aiSessionLimiter.reset(); daily.day = ''; daily.count = 0; }

const clientIp = (c: Context) => (c.req.header('x-forwarded-for')?.split(',')[0].trim()) || (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress || 'local';

// ---------- App ----------
export const app = new Hono();

app.use('*', async (c, next) => {
  const t0 = performance.now();
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  if (c.req.path.startsWith('/api') || (c.res.headers.get('content-type') ?? '').includes('text/html')) c.header('Cache-Control', 'no-store');
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${(performance.now() - t0).toFixed(1)}ms`);
});

app.get('/favicon.ico', (c) => c.body(null, 204));
app.get('/healthz', (c) => c.json({ ok: true, commit, ai: { configured: !!provider, provider: provider?.name ?? null, model: provider?.model ?? null } }));

const loginPage = (error: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Circuit Factory</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f5;color:#1b1f1d}@media(prefers-color-scheme:dark){body{background:#131615;color:#e7ebe8}.card{background:#1c201e;border-color:#343b37}input{background:#131615;color:#e7ebe8;border-color:#343b37}}
.card{width:min(320px,calc(100vw - 32px));border:1px solid #d8ddd8;border-radius:8px;padding:20px;background:#fff;box-sizing:border-box}h1{font-size:18px;margin:0 0 14px;font-weight:600}label{display:block;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:#5f6763;margin:10px 0 3px}
input{width:100%;box-sizing:border-box;border:1px solid #d8ddd8;border-radius:6px;padding:8px 10px;font:14px ui-monospace,Menlo,monospace}button{margin-top:14px;width:100%;padding:9px;border:0;border-radius:6px;background:#1f5fa8;color:#fff;font-weight:500;font-size:14px;cursor:pointer}.err{color:#b42318;font-size:13px;margin:0 0 4px}</style></head>
<body><form class="card" method="post" action="/login"><h1>Circuit Factory</h1>${error ? '<p class="err">That username and password did not match.</p>' : ''}
<label for="username">Username</label><input id="username" name="username" autocomplete="username" required autofocus>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Enter</button></form></body></html>`;

app.get('/login', (c) => c.html(loginPage(c.req.query('error') === '1')));

app.post('/login', async (c) => {
  if (!loginLimiter.hit(clientIp(c))) return c.text('Too many login attempts. Try again in a minute.', 429);
  const body = await c.req.parseBody();
  const u = String(body['username'] ?? ''), p = String(body['password'] ?? '');
  const ok = config.gateUser.length > 0 && config.gatePass.length > 0 && safeEq(u, config.gateUser) && safeEq(p, config.gatePass);
  if (!ok) return c.redirect('/login?error=1', 303);
  setCookie(c, COOKIE, mintSession(), { httpOnly: true, sameSite: 'Lax', path: '/', secure: PROD, maxAge: SESSION_MS / 1000 });
  return c.redirect('/', 303);
});

// Auth gate for everything below.
app.use('*', async (c: Context, next: Next) => {
  if (validSession(getCookie(c, COOKIE))) return next();
  const wantsHtml = (c.req.header('accept') ?? '').includes('text/html');
  if (c.req.path.startsWith('/api') || !wantsHtml) return c.json({ error: 'Not authenticated' }, 401);
  return c.redirect('/login', 303);
});

app.post('/api/logout', (c) => { deleteCookie(c, COOKIE, { path: '/' }); return c.json({ ok: true }); });

app.get('/api/ai/status', (c) => c.json({ configured: !!provider, provider: provider?.name ?? null, model: provider?.model ?? null }));

const BODY_LIMIT = 256 * 1024;
app.post('/api/review', async (c) => {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > BODY_LIMIT) return c.json({ error: 'Request body exceeds 256 KB' }, 413);
  const raw = await c.req.text();
  if (raw.length > BODY_LIMIT) return c.json({ error: 'Request body exceeds 256 KB' }, 413);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return c.json({ error: 'Body is not valid JSON' }, 400); }
  const parsed = Project.safeParse(json);
  if (!parsed.success) return c.json({ error: 'Project failed schema validation', issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) }, 400);
  const problems = integrityProblems(parsed.data, registry);
  if (problems.length) return c.json({ error: 'Project references parts or pins the registry does not know', issues: problems.slice(0, 10) }, 400);
  if (!provider) return c.json({ error: 'AI review is not configured' }, 503);
  if (!aiSessionLimiter.hit(getCookie(c, COOKIE) ?? 'anon')) return c.json({ error: `AI review limit reached for this session (${config.aiHourlyLimit} per hour). Try again later.` }, 429);
  if (!dailyOk()) return c.json({ error: 'AI review daily cap reached for this deployment. Try again tomorrow.' }, 429);
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 60_000));
  try {
    const result = await Promise.race([ai.reviewProject(parsed.data, registry, provider), timeout]);
    return c.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'timeout') return c.json({ error: 'AI review timed out after 60 seconds' }, 504);
    console.error('[circuit] review failed:', msg);
    return c.json({ error: 'AI review failed on the server. The error was logged; nothing was shown.' }, 502);
  }
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Static SPA behind the gate.
app.use('/*', serveStatic({ root: config.distDir }));
app.get('/*', (c) => {
  const index = join(config.distDir, 'index.html');
  if (!existsSync(index)) return c.text('Build not found. Run `npm run build`.', 503);
  return c.html(readFileSync(index, 'utf8'));
});
