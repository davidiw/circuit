// Generates docs/pin-sweep.md: which pin-to-pin connections the rules reveal, which are allowed, and which are silent gaps. Run: npm run sweep
import { writeFileSync, mkdirSync } from 'node:fs';
import { registry, templates } from '../src/data';
import { runPinSweep } from '../src/eval/sweep';

const lines: string[] = ['# Pin-to-pin connection coverage', '', `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run sweep\`. Every pin of every part was connected to every pin of every other part, one pair at a time, and the deterministic rules ran on the result.`, '',
  '**Basis.** Expectations come from the KiCad default ERC pin-type matrix (the industry list of which pin electrical types may share a net), plus domain rules for what that matrix cannot express: shorts to ground and motors that need a driver. **This is best effort, and honest about it.** *Covered* means every tested pair of that kind produced a violation or warning. *Allowed* means KiCad calls the pairing OK and silence is correct. *Gap* means KiCad calls it OK but a domain expert would still question it and no rule models it yet; the reason is in the last column. The coverage panel in the app lists evaluated dimensions for the same reason: a clean findings list only speaks for what was checked.', ''];
for (const t of templates) {
  const { cases, summary } = runPinSweep(t, registry);
  lines.push(`## ${t.title}`, '', `${cases.length} pin pairs · ${summary.filter((s) => s.verdict === 'covered').length} covered kinds · ${summary.filter((s) => s.verdict === 'allowed').length} allowed kinds · ${summary.filter((s) => s.verdict === 'gap').length} gap kinds · ${summary.filter((s) => s.verdict === 'MISSED').length} missed`, '', '| Pin roles | KiCad | Expectation | Pairs | Fired | Verdict | Why |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of summary) lines.push(`| ${s.key.replace('+', ' to ')} | ${s.kicad} | ${s.expectation} | ${s.tested} | ${s.fired} | ${s.verdict} | ${s.why} |`);
  lines.push('');
}
mkdirSync('docs', { recursive: true }); writeFileSync('docs/pin-sweep.md', lines.join('\n')); console.log('wrote docs/pin-sweep.md');
