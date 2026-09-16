import { z } from 'zod';

export const EventKind = z.enum([
  'open_template', 'submit_intent', 'answer_question', 'accept_defaults', 'resolve_part', 'evaluate', 'view_finding', 'view_coverage',
  'select_instance', 'apply_mutation', 'edit', 'override_finding', 'ai_review', 'reset', 'dismiss_tip',
]);
export type EventKind = z.infer<typeof EventKind>;

export const HistoryEvent = z.object({
  kind: EventKind,
  at: z.string(),
  stateHash: z.string(),
  ref: z.string().optional(), // finding id, mutation id, tip id, instance id
});
export type HistoryEvent = z.infer<typeof HistoryEvent>;
