import { z } from 'zod';

// ---------- Provenance ----------
export const Provenance = z.enum(['vetted_source', 'fixture_assumption', 'user', 'ai', 'unknown']);
export type Provenance = z.infer<typeof Provenance>;

export const Fact = z.object({
  value: z.unknown(),
  provenance: Provenance,
  source: z.string().optional(),
  note: z.string().optional(),
});
export type Fact = z.infer<typeof Fact>;

// ---------- Registry ----------
export const PinRole = z.enum([
  'supply_in', 'supply_out', 'ground', 'logic_in', 'logic_out', 'gpio', 'enable_in',
  'motor_out', 'motor_in', 'anode', 'cathode', 'battery_pos', 'cap_pos', 'analog_out', 'analog_in',
  'csi', 'i2s', 'speaker_out', 'speaker_in', 'switch',
]);
export type PinRole = z.infer<typeof PinRole>;

export const VoltageRange = z.object({ min: z.number(), max: z.number() });

/** How a supply_out pin derives its voltage during net propagation. */
export const PinOutput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), v: z.number() }),
  z.object({ kind: z.literal('prop'), prop: z.string() }),                 // instance prop, e.g. outputV
  z.object({ kind: z.literal('fact'), nominal: z.string(), min: z.string().optional(), max: z.string().optional() }),
  z.object({ kind: z.literal('from_pin'), pin: z.string(), drop_fact: z.string() }), // e.g. diode cathode = anode - forward_drop_v
]);

export const RegistryPin = z.object({
  name: z.string(),
  role: PinRole,
  pwm: z.boolean().optional(),
  pwm_required: z.boolean().optional(),
  supply_range: VoltageRange.optional(),
  supply_range_provenance: Provenance.optional(),
  output: PinOutput.optional(),
  channel: z.string().optional(),
  note: z.string().optional(),
});
export type RegistryPin = z.infer<typeof RegistryPin>;

export const VerificationStatus = z.enum([
  'vetted_candidate', 'vetted_candidate_for_prototype', 'constrained_component_class', 'ai_extracted_unverified', 'incomplete', 'unsupported',
]);

export const RegistryComponent = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  manufacturer: z.string().nullable(),
  mpn: z.string().nullable(),
  verification_status: VerificationStatus,
  prototype_interface: z.object({ type: z.string(), requires_light_soldering: z.boolean() }).optional(),
  breadboard_usable: z.boolean().optional(),
  pins: z.array(RegistryPin),
  facts: z.record(z.string(), Fact),
  capabilities: z.array(z.string()).default([]),
  board_features: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type RegistryComponent = z.infer<typeof RegistryComponent>;

export const Registry = z.object({ schema_version: z.literal(1), components: z.array(RegistryComponent) });
export type Registry = z.infer<typeof Registry>;

// ---------- Project ----------
export const Requirement = z.object({
  id: z.string(),
  kind: z.string(),        // capability | motor_count | pwm_speed_control | runtime_minutes | video | audio_output | audio_input | sensing | envelope | power_mode | ...
  label: z.string(),
  value: z.unknown().optional(),
  evaluable: z.boolean(),
});
export type Requirement = z.infer<typeof Requirement>;

export const Instance = z.object({
  id: z.string(),
  registryId: z.string(),
  label: z.string(),
  props: z.record(z.string(), Fact).default({}),
});
export type Instance = z.infer<typeof Instance>;

export const PinRef = z.object({ instance: z.string(), pin: z.string() });
export type PinRef = z.infer<typeof PinRef>;

export const Net = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['power', 'ground', 'signal', 'motor', 'bus']),
  pins: z.array(PinRef),
});
export type Net = z.infer<typeof Net>;

export const Assumption = z.object({
  key: z.string(),
  value: z.unknown(),
  reason: z.string(),
  source: z.enum(['template', 'ai', 'user']),
  status: z.enum(['active', 'overridden']).default('active'),
});
export type Assumption = z.infer<typeof Assumption>;

export const Override = z.object({ ruleId: z.string(), instanceId: z.string().optional(), note: z.string() });

export const Severity = z.enum(['violation', 'warning', 'unknown', 'optimization', 'unsupported']);
export type Severity = z.infer<typeof Severity>;

export const Finding = z.object({
  id: z.string(),
  ruleId: z.string(),
  origin: z.enum(['deterministic', 'ai_review']),
  basis: z.enum(['component_spec', 'assumption', 'heuristic', 'ai_inference']),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  affected: z.array(z.object({ instanceId: z.string().optional(), pin: z.string().optional(), netId: z.string().optional() })),
  evidence: z.array(z.object({ label: z.string(), value: z.string(), provenance: Provenance })),
  consequence: z.string(),
  remediation: z.array(z.string()),
  missing: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type Finding = z.infer<typeof Finding>;

export const CoverageStatus = z.enum(['checked', 'partial', 'estimated', 'heuristic', 'not_evaluated', 'unsupported']);
export const CoverageOutcome = z.enum(['pass', 'violation', 'warning', 'unknown']);
export const CoverageEntry = z.object({ dimension: z.string(), group: z.enum(['electrical', 'product']), status: CoverageStatus, note: z.string(), outcome: CoverageOutcome.optional(), findingCount: z.number().optional() });
export type CoverageEntry = z.infer<typeof CoverageEntry>;

export const EvaluationResult = z.object({
  status: z.enum(['complete', 'incomplete']),
  findings: z.array(Finding),
  coverage: z.array(CoverageEntry),
  stateHash: z.string(),
  evaluatedAt: z.string(),
});
export type EvaluationResult = z.infer<typeof EvaluationResult>;

// Structured mutation ops: the same ops drive UI buttons and tests.
export const MutationOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('remove_instance'), instance: z.string() }),
  z.object({ op: z.literal('move_pin'), instance: z.string(), pin: z.string(), net: z.string().nullable() }), // null = disconnect
  z.object({ op: z.literal('set_prop'), instance: z.string(), prop: z.string(), value: z.unknown(), provenance: Provenance.default('user') }),
  z.object({ op: z.literal('swap_registry'), instance: z.string(), registryId: z.string() }),
  z.object({ op: z.literal('set_assumption'), key: z.string(), value: z.unknown() }),
  z.object({ op: z.literal('clear_power_source') }),
]);
export type MutationOp = z.infer<typeof MutationOp>;

export const ExpectedFinding = z.object({
  ruleId: z.string(),
  severity: Severity,
  category: z.string(),
  affectedInstance: z.string().optional(),
});

export const Mutation = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  ops: z.array(MutationOp),
  expected: z.array(ExpectedFinding),
  expectAbsent: z.array(z.string()).default([]), // ruleIds that must be absent after the mutation
  expectStatus: z.enum(['complete', 'incomplete']).optional(),
});
export type Mutation = z.infer<typeof Mutation>;

export const Project = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  schemaVersion: z.literal(1),
  source: z.enum(['template', 'generated', 'imported']),
  status: z.enum(['golden_candidate', 'fixture_candidate', 'generated']).default('generated'),
  requirements: z.array(Requirement),
  power: z.object({ sourceInstance: z.string().nullable(), mode: z.enum(['battery', 'continuous', 'unresolved']) }),
  instances: z.array(Instance),
  nets: z.array(Net),
  assumptions: z.array(Assumption),
  overrides: z.array(Override).default([]),
  unresolved: z.array(z.string()).default([]),   // generated designs: component needs not yet mapped to the registry
  mutations: z.array(Mutation).default([]),
  expectedBaseline: z.array(ExpectedFinding).default([]),
  lastEvaluation: EvaluationResult.optional(),
});
export type Project = z.infer<typeof Project>;
