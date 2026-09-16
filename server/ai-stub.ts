// Fallback used only when src/ai has not been built yet. Mirrors the contract the AI fork implements.
import type { Project, Registry, Finding } from '../src/model/schema';

export type Provider = {
  name: 'anthropic' | 'gemini' | 'fake';
  model: string;
  complete(req: { system: string; user: string; schema: Record<string, unknown>; maxTokens: number }): Promise<{ json: unknown; latencyMs: number; usage: { input: number; output: number } }>;
};
export type ReviewResult = { observations: Finding[]; dropped: number; provider: string; model: string; latencyMs: number; usage: { input: number; output: number } };

export type AiModule = {
  createProviderFromEnv(env: NodeJS.ProcessEnv): Provider | null;
  reviewProject(project: Project, registry: Registry, provider: Provider): Promise<ReviewResult>;
};

/** Load the real AI module if present; otherwise a stub that reports AI as unconfigured. */
export async function loadAi(): Promise<AiModule> {
  try {
    // Specifiers are built at runtime so the server compiles before src/ai exists.
    const base = '../src/ai/';
    const [p, r] = await Promise.all([import(base + 'provider') as Promise<Partial<AiModule>>, import(base + 'review') as Promise<Partial<AiModule>>]);
    if (!p.createProviderFromEnv || !r.reviewProject) throw new Error('incomplete ai module');
    return { createProviderFromEnv: p.createProviderFromEnv, reviewProject: r.reviewProject };
  } catch {
    return {
      createProviderFromEnv: () => null,
      reviewProject: async () => { throw new Error('AI module not available'); },
    };
  }
}
