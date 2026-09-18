import { Hono, type Context, type Next } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
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
export const config = {
  port: Number(env.PORT ?? 8797),
  aiHourlyLimit: Number(env.AI_HOURLY_LIMIT ?? 30),
  aiDailyCap: Number(env.AI_DAILY_CAP ?? 500),
  distDir: env.DIST_DIR ?? 'dist',
};

const commit = env.COMMIT_SHA ?? (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; } })();

const ai = await loadAi();
let provider: Provider | null = null;
try { provider = ai.createProviderFromEnv(env); } catch (e) { console.warn('[circuit] AI provider not configured:', (e as Error).message); }
export function setProvider(p: Provider | null) { provider = p; }

// ---------- Rate limits (in memory) ----------
class Window { private hits = new Map<string, number[]>(); constructor(private limit: number, private ms: number) {}
  hit(key: string, now = Date.now()) { const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms); arr.push(now); this.hits.set(key, arr); return arr.length <= this.limit; }
  reset() { this.hits.clear(); } }
export const aiClientLimiter = new Window(config.aiHourlyLimit, 3_600_000);
const daily = { day: '', count: 0 };
function dailyOk() { const d = new Date().toISOString().slice(0, 10); if (daily.day !== d) { daily.day = d; daily.count = 0; } return ++daily.count <= config.aiDailyCap; }
export function resetLimits() { aiClientLimiter.reset(); daily.day = ''; daily.count = 0; }

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

// No access gate: the prototype holds no sensitive content. The AI review endpoint is bounded by per-client and daily limits instead.
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
  if (!aiClientLimiter.hit(clientIp(c))) return c.json({ error: `AI review limit reached for this client (${config.aiHourlyLimit} per hour). Try again later.` }, 429);
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

// Static SPA.
app.use('/*', serveStatic({ root: config.distDir }));
app.get('/*', (c) => {
  const index = join(config.distDir, 'index.html');
  if (!existsSync(index)) return c.text('Build not found. Run `npm run build`.', 503);
  return c.html(readFileSync(index, 'utf8'));
});
