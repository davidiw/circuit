import { useState } from 'react';

/** Development-only gate. Production builds never render this: the server authenticates before serving the app. */
export function Gate({ onAuthed, dev }: { onAuthed: () => void; dev: boolean }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (u === (import.meta.env.VITE_DEV_GATE_USER ?? '') && p === (import.meta.env.VITE_DEV_GATE_PASS ?? '') && u) { try { sessionStorage.setItem('cf.dev.authed', '1'); } catch { /* ignore */ } onAuthed(); } else setErr('Wrong username or password.');
  };
  return (
    <div className="gate-wrap">
      <form className="gate" onSubmit={submit}>
        <div className="brand">Circuit Factory</div>
        {dev && <div className="muted small">Development gate. The deployed build authenticates on the server.</div>}
        <label htmlFor="gate-user">Username</label><input id="gate-user" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" />
        <label htmlFor="gate-pass">Password</label><input id="gate-pass" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        {err && <div className="error">{err}</div>}
        <button className="btn primary" type="submit">Enter</button>
      </form>
    </div>
  );
}
