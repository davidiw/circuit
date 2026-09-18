import { describe, it, expect, beforeEach } from 'vitest';
import { app, resetLimits, setProvider, config } from '../index';
import { FakeProvider } from '../../src/ai/fake';

const json = (body: string, ip = '203.0.113.7') => ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body });
beforeEach(() => { resetLimits(); setProvider(null); });

describe('server without an access gate', () => {
  it('healthz reports ok and the AI configuration', async () => {
    const r = await app.request('/healthz'); expect(r.status).toBe(200); const b = await r.json(); expect(b.ok).toBe(true); expect(b.ai).toEqual({ configured: false, provider: null, model: null });
  });
  it('the page and the API are open: no redirect, no cookie, no 401', async () => {
    const page = await app.request('/', { headers: { accept: 'text/html' } });
    expect([200, 503]).toContain(page.status);   // 200 with a build, 503 "Build not found" without one; never a redirect
    expect(page.headers.get('location')).toBeNull(); expect(page.headers.get('set-cookie')).toBeNull();
    const r = await app.request('/api/ai/status'); expect(r.status).toBe(200); expect(await r.json()).toEqual({ configured: false, provider: null, model: null });
  });
  it('no login or logout route exists (any path is just the app)', async () => {
    const r = await app.request('/login', { headers: { accept: 'text/html' } }); if (r.status === 200) expect(await r.text()).not.toMatch(/name="password"/);
    expect((await app.request('/api/logout', { method: 'POST' })).status).toBe(404);
  });
  it('api responses are never cached and are nosniff', async () => {
    const r = await app.request('/api/ai/status'); expect(r.headers.get('cache-control')).toBe('no-store'); expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('/api/review', () => {
  it('503 when AI is not configured, after the project was validated', async () => {
    const { templates } = await import('../../src/data');
    const r = await app.request('/api/review', json(JSON.stringify(templates[0])));
    expect(r.status).toBe(503); expect((await r.json()).error).toBe('AI review is not configured');
  });
  it('400 on an invalid project, with issues but no internals', async () => {
    const r = await app.request('/api/review', json('{"id":1}')); expect(r.status).toBe(400);
    const b = await r.json(); expect(b.error).toBe('Project failed schema validation'); expect(Array.isArray(b.issues)).toBe(true);
  });
  it('400 on a project that references parts the registry does not know', async () => {
    const { templates } = await import('../../src/data');
    const forged = { ...templates[0], instances: [...templates[0].instances, { id: 'ghost', registryId: 'nope.part', label: 'Ghost', props: {} }] };
    const r = await app.request('/api/review', json(JSON.stringify(forged))); expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/registry does not know/);
  });
  it('400 on a body that is not JSON', async () => {
    const r = await app.request('/api/review', json('not json')); expect(r.status).toBe(400); expect((await r.json()).error).toBe('Body is not valid JSON');
  });
  it('413 on a body over 256 KB', async () => {
    const r = await app.request('/api/review', json(JSON.stringify({ pad: 'x'.repeat(300 * 1024) }))); expect(r.status).toBe(413);
  });
  it('rate-limits per client address, not globally', async () => {
    const { templates } = await import('../../src/data');
    setProvider(new FakeProvider(() => ({ observations: [] })));
    const body = JSON.stringify(templates[2]);
    for (let i = 0; i < config.aiHourlyLimit; i++) expect((await app.request('/api/review', json(body, '198.51.100.1'))).status, `call ${i + 1}`).not.toBe(429);
    expect((await app.request('/api/review', json(body, '198.51.100.1'))).status).toBe(429);
    expect((await app.request('/api/review', json(body, '198.51.100.2'))).status).not.toBe(429);
  });
  it('unknown api routes are 404 json', async () => {
    const r = await app.request('/api/nothing'); expect(r.status).toBe(404); expect((await r.json()).error).toBe('Not found');
  });
});
