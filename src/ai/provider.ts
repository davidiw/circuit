import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';

/** Provider boundary. JSON in, JSON out. Nothing outside src/ai and the server knows which vendor answered. */
export type CompletionRequest = { system: string; user: string; schema: Record<string, unknown>; maxTokens: number };
export type CompletionResult = { json: unknown; latencyMs: number; usage: { input: number; output: number } };

export interface Provider {
  readonly name: 'anthropic' | 'gemini' | 'fake';
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export const DEFAULT_MODELS = { anthropic: 'claude-sonnet-5', gemini: 'gemini-3.8-flash' } as const;

export { cleanSchema } from './schema-util';

export function createProvider(name: 'anthropic' | 'gemini', model: string | undefined, apiKey: string): Provider {
  if (name === 'anthropic') return new AnthropicProvider(apiKey, model ?? DEFAULT_MODELS.anthropic);
  return new GeminiProvider(apiKey, model ?? DEFAULT_MODELS.gemini);
}

export function createProviderFromEnv(env: NodeJS.ProcessEnv): Provider | null {
  const name = (env.AI_PROVIDER ?? 'none').toLowerCase();
  if (name === 'anthropic' && env.ANTHROPIC_API_KEY) return createProvider('anthropic', env.AI_MODEL || undefined, env.ANTHROPIC_API_KEY);
  if (name === 'gemini' && env.GEMINI_API_KEY) return createProvider('gemini', env.AI_MODEL || undefined, env.GEMINI_API_KEY);
  return null;
}
