import { describe, it, expect, beforeEach } from 'vitest';
import { app, resetLimits, setProvider, mintSession } from '../index';

const form = (username: string, password: string) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password }).toString() });
const html = { headers: { accept: 'text/html' } };

beforeEach(() => { resetLimits(); setProvider(null); });

describe('gate', () => {
  it('redirects unauthenticated browser navigation to /login', async () => {
    const r = await app.request('/', html);
    expect(r.status).toBe(303); expect(r.headers.get('location')).toBe('/login');
  });
  it('serves the login page', async () => {
    const r = await app.request('/login'); expect(r.status).toBe(200); expect(await r.text()).toContain('Circuit Factory');
  });
  it('rejects a wrong password without a cookie', async () => {
    const r = await app.request('/login', form('test-user', 'wrong'));
    expect(r.status).toBe(303); expect(r.headers.get('location')).toBe('/login?error=1'); expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('sets a cookie on the right password', async () => {
    const r = await app.request('/login', form('test-user', 'test-pass'));
    expect(r.status).toBe(303); expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('set-cookie')).toMatch(/cf_session=\d+\.[0-9a-f]{64}; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax/);
  });
  it('trips the login rate limit on the 11th attempt', async () => {
    for (let i = 0; i < 10; i++) expect((await app.request('/login', form('x', 'y'))).status).toBe(303);
    expect((await app.request('/login', form('x', 'y'))).status).toBe(429);
  });
});

describe('api', () => {
  const cookie = { cookie: `cf_session=${mintSession()}` };
  it('401 on /api/ai/status without a cookie', async () => {
    const r = await app.request('/api/ai/status'); expect(r.status).toBe(401);
  });
  it('200 on /api/ai/status with a cookie', async () => {
    const r = await app.request('/api/ai/status', { headers: cookie }); expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ configured: false, provider: null, model: null });
  });
  it('rejects a forged cookie', async () => {
    const r = await app.request('/api/ai/status', { headers: { cookie: `cf_session=${Date.now()}.${'0'.repeat(64)}` } }); expect(r.status).toBe(401);
  });
  it('503 on /api/review when AI is not configured', async () => {
    const { templates } = await import('../../src/data');
    const r = await app.request('/api/review', { method: 'POST', headers: { ...cookie, 'content-type': 'application/json' }, body: JSON.stringify(templates[0]) });
    expect(r.status).toBe(503); expect((await r.json()).error).toBe('AI review is not configured');
  });
  it('400 on /api/review with an invalid project', async () => {
    const r = await app.request('/api/review', { method: 'POST', headers: { ...cookie, 'content-type': 'application/json' }, body: '{"id":1}' });
    expect(r.status).toBe(400);
  });
  it('413 on a body over 256 KB', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(300 * 1024) });
    const r = await app.request('/api/review', { method: 'POST', headers: { ...cookie, 'content-type': 'application/json' }, body });
    expect(r.status).toBe(413);
  });
  it('healthz needs no auth', async () => {
    const r = await app.request('/healthz'); expect(r.status).toBe(200); expect((await r.json()).ok).toBe(true);
  });
});
