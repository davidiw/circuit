import { Component, type ReactNode } from 'react';
import { useAppStore } from './store';
import { STORAGE_KEY } from './storage';

class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const resetAll = () => { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } location.reload(); };
    return (
      <div className="page"><div className="panel" style={{ maxWidth: 640, margin: '40px auto' }}>
        <h4>Something broke while drawing this screen</h4>
        <p className="small">The design state is saved. Reload to try again; if it breaks again, clear the saved sessions and start from the templates.</p>
        <pre className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error.message)}</pre>
        <div className="row wrap"><button className="btn primary" onClick={() => location.reload()}>Reload</button><button className="btn danger" onClick={resetAll}>Clear saved sessions and reload</button></div>
      </div></div>
    );
  }
}
import { Gate } from './Gate';
import { Library } from './Library';
import { ProjectView } from './ProjectView';

export function App() { return <ErrorBoundary><Inner /></ErrorBoundary>; }

function Inner() {
  const { state, dispatch, isDev } = useAppStore();
  if (state.view === 'gate') return <Gate onAuthed={() => dispatch({ type: 'AUTHED' })} dev={isDev} />;
  if (state.view === 'library' || !state.activeId || !state.sessions[state.activeId]) return <Library state={state} dispatch={dispatch} />;
  return <ProjectView session={state.sessions[state.activeId]} state={state} dispatch={dispatch} />;
}
