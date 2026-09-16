import { useAppStore } from './store';
import { Gate } from './Gate';
import { Library } from './Library';
import { ProjectView } from './ProjectView';

export function App() {
  const { state, dispatch, isDev } = useAppStore();
  if (state.view === 'gate') return <Gate onAuthed={() => dispatch({ type: 'AUTHED' })} dev={isDev} />;
  if (state.view === 'library' || !state.activeId || !state.sessions[state.activeId]) return <Library state={state} dispatch={dispatch} />;
  return <ProjectView session={state.sessions[state.activeId]} state={state} dispatch={dispatch} />;
}
