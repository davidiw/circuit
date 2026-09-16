import { finding, type Rule } from '../context';
import type { CoverageEntry, Requirement } from '../../model/schema';

const INFORMATIONAL_KINDS = ['build_mode', 'exclusion'];
const DIM_FOR_KIND: Record<string, string> = { envelope: 'size_envelope', streaming_latency: 'streaming_latency', standby_life: 'standby_life' };

/** Product-level check: does the architecture plausibly satisfy each evaluable requirement? Independent of electrical coherence. */
export const requirement_capability: Rule = {
  id: 'requirement_capability', origin: 'deterministic', dimensions: ['product_requirements'],
  analyze(ctx) {
    const findings = [] as ReturnType<typeof finding>[];
    const coverage: CoverageEntry[] = [];
    const fail = (r: Requirement, title: string, evidence: { label: string; value: string }[], consequence: string, remediation: string[]) =>
      findings.push(finding({ ruleId: 'requirement_capability', basis: 'component_spec', severity: 'violation', category: 'requirement', title,
        affected: [], evidence: evidence.map((e) => ({ ...e, provenance: 'vetted_source' as const })), consequence, remediation, missing: [r.label] }));
    let checked = 0;
    for (const r of ctx.project.requirements) {
      if (!r.evaluable) { if (!INFORMATIONAL_KINDS.includes(r.kind)) coverage.push({ dimension: DIM_FOR_KIND[r.kind] ?? r.kind, group: 'product', status: 'not_evaluated', note: r.label }); continue; }
      switch (r.kind) {
        case 'capability': {
          checked++;
          const have = ctx.instancesWithCapability(String(r.value));
          if (!have.length) fail(r, `No part provides ${r.label.toLowerCase()}`, [{ label: 'capability', value: String(r.value) }, { label: 'parts', value: ctx.project.instances.map((i) => i.id).join(', ') }], `The requirement "${r.label}" cannot be met by the parts in this design.`, [`Add a part whose registry entry lists the ${r.value} capability`]);
          break;
        }
        case 'motor_count': {
          checked++;
          const n = Number(r.value); const motors = ctx.instancesOfKind('dc_gearmotor').length;
          const channels = ctx.instancesOfKind('motor_driver').reduce((s, d) => s + (ctx.fact(d.id, 'h_bridge_channels')?.value ?? 0), 0);
          if (motors < n || channels < n) fail(r, `${motors} motors and ${channels} driver channels for a ${n}-motor requirement`, [{ label: 'motors', value: String(motors) }, { label: 'h_bridge_channels', value: String(channels) }], 'Independent control of the required motor count is not possible.', ['Add motors or driver channels']);
          break;
        }
        case 'h_bridge_per_motor': {
          checked++;
          if (!ctx.instancesWithCapability('dc_motor_drive').length) fail(r, 'No H-bridge driver for forward and reverse', [{ label: 'capability', value: 'dc_motor_drive' }], 'Motors cannot reverse without an H-bridge.', ['Add a dual H-bridge driver']);
          break;
        }
        case 'pwm_speed_control': {
          checked++;
          for (const d of ctx.instancesOfKind('motor_driver')) for (const pin of ctx.comp(d.id)!.pins.filter((p) => p.pwm_required)) {
            const net = ctx.netOf(d.id, pin.name); const ok = net && ctx.netPins(net).some((p) => p.def.role === 'gpio' && p.def.pwm);
            if (!ok) fail(r, `${d.label} ${pin.name} is not driven by a PWM-capable GPIO`, [{ label: 'net', value: net?.name ?? 'unconnected' }], 'Speed control is unavailable on this channel.', ['Route the PWM input to a PWM-capable GPIO']);
          }
          break;
        }
        case 'power_mode': {
          checked++;
          if (!ctx.hasPower || ctx.project.power.mode !== r.value) fail(r, `Power mode is ${ctx.hasPower ? ctx.project.power.mode : 'unresolved'}, requirement is ${r.value}`, [{ label: 'power.mode', value: ctx.project.power.mode }], 'The power architecture does not match the product requirement.', ['Set a power source of the required kind']);
          break;
        }
        case 'video': {
          checked++;
          if (!ctx.instancesWithCapability(`video_${r.value}`).length) fail(r, `No camera provides ${r.value}`, [{ label: 'capability', value: `video_${r.value}` }], 'The video requirement cannot be met.', ['Add a camera module whose registry entry lists this video mode']);
          break;
        }
        case 'audio_output': {
          checked++;
          const amps = ctx.instancesWithCapability('mono_speaker_output'); const spk = ctx.instancesWithCapability('speaker');
          const wired = spk.some((s) => ctx.comp(s.id)!.pins.every((p) => { const n = ctx.netOf(s.id, p.name); return n && ctx.netPins(n).some((q) => q.def.role === 'speaker_out'); }));
          if (!amps.length || !spk.length || !wired) fail(r, `Speaker output path incomplete (${amps.length} amplifier, ${spk.length} speaker${wired ? '' : ', not wired'})`, [{ label: 'amplifiers', value: amps.map((a) => a.id).join(', ') || 'none' }, { label: 'speakers', value: spk.map((s) => s.id).join(', ') || 'none' }], 'No audio can be played.', ['Add an amplifier and speaker and wire the speaker to the amplifier outputs']);
          break;
        }
        case 'runtime_minutes': break; // handled by runtime_estimate
        default: coverage.push({ dimension: r.kind, group: 'product', status: 'unsupported', note: `${r.label}: no evaluator for kind ${r.kind}` });
      }
    }
    coverage.unshift({ dimension: 'product_requirements', group: 'product', status: 'checked', note: `${checked} evaluable requirements mapped to capabilities` });
    return { findings, coverage };
  },
};
