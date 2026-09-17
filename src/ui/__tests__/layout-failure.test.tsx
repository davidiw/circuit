// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useReducer } from 'react';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { templates } from '../../data';
import { reducer, type AppState } from '../store';
import { ProjectView } from '../ProjectView';
import { Library } from '../Library';

// Force the layout engine to fail for every call: this is what a future state the sweeps never saw would look like.
vi.mock('../../eval/layout', () => ({ layout: vi.fn(async () => { throw new Error('elk exploded on this graph'); }) }));

afterEach(cleanup);
function Harness({ init }: { init: AppState }) {
  const [state, dispatch] = useReducer(reducer, init);
  if (state.view !== 'project' || !state.activeId) return <Library state={state} dispatch={dispatch} />;
  return <ProjectView session={state.sessions[state.activeId]} state={state} dispatch={dispatch} />;
}

/**
 * Regression contract for graceful layout failure. The exhaustive sweeps protect the state space we know; this protects the
 * one we do not: when layout rejects, the page stays up with a readable fallback, the diagram is the only thing missing, and
 * the surrounding controls (Undo, Reset, navigation) still work so the user can get back to a state that draws.
 */
describe('graceful layout failure', () => {
  it('page stays mounted with a fallback; findings, Undo, Reset, and Back still work', async () => {
    const errors: string[] = []; const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')); });
    const init = [{ type: 'AUTHED' as const }, { type: 'OPEN_TEMPLATE' as const, id: templates[0].id }, { type: 'EVALUATE' as const }, { type: 'APPLY_MUTATION' as const, id: 'force_stby_low' }, { type: 'EVALUATE' as const }].reduce(reducer, { view: 'library', sessions: {}, aiBusy: false } as AppState);
    const out = render(<Harness init={init} />);
    await waitFor(() => expect(out.container.querySelector('.dia')?.textContent).toMatch(/Layout unavailable/), { timeout: 4000 });
    // Not a white screen: the app bar, stepper, findings (with the real violation), and changes are all present without a diagram.
    for (const sel of ['.appbar', '.stepper', '#panel-findings', '#panel-optimize']) expect(out.container.querySelector(sel), `${sel} still mounted`).toBeTruthy();
    expect(out.container.querySelector('svg')).toBeNull();
    expect(out.container.querySelector('.finding.bad'), 'findings still shown').toBeTruthy();
    expect(out.container.querySelector('.chip.cur'), 'state chip still reads current').toBeTruthy();
    // The failure is logged once per layout attempt and nothing else errored.
    expect(errors.filter((e) => !e.startsWith('layout failed')), 'no other console errors').toEqual([]);
    // Undo works: the edit count drops and the evaluation goes stale.
    const undo = [...out.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Undo'))!;
    expect(undo.textContent).toContain('(1)'); fireEvent.click(undo);
    await waitFor(() => expect(out.container.querySelector('.chip.stale')).toBeTruthy());
    expect([...out.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Undo'))!.textContent).toBe('Undo');
    // Reset after another change works through the Changes panel.
    fireEvent.click([...out.container.querySelectorAll('.exp button')].find((b) => !(b as HTMLButtonElement).disabled)!);
    const reset = await waitFor(() => { const b = [...out.container.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Reset to')); expect(b).toBeTruthy(); return b!; });
    fireEvent.click(reset);
    await waitFor(() => expect([...out.container.querySelectorAll('button')].some((x) => x.textContent?.startsWith('Reset to'))).toBe(false));
    // Re-evaluate still runs the rules with no diagram.
    fireEvent.click(out.container.querySelector('#btn-evaluate')!);
    await waitFor(() => expect(out.container.querySelector('.chip.cur')).toBeTruthy(), { timeout: 3000 });
    expect(out.container.querySelector('.dia')?.textContent).toMatch(/Layout unavailable/);
    // Navigation back to the library works.
    fireEvent.click(out.container.querySelector('[aria-label="Back to library"]')!);
    await waitFor(() => expect(out.container.querySelector('.cards')).toBeTruthy());
    spy.mockRestore();
  });
});
