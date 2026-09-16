import type { CompletionRequest, CompletionResult, Provider } from './provider';

/** Scripted provider for tests and the benchmark dry run. Records every request. */
export class FakeProvider implements Provider {
  readonly name = 'fake' as const;
  readonly calls: CompletionRequest[] = [];
  constructor(private readonly respond: (req: CompletionRequest) => unknown, readonly model = 'fake-1') {}
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const json = this.respond(req);
    return { json, latencyMs: 1, usage: { input: Math.ceil((req.system.length + req.user.length) / 4), output: Math.ceil(JSON.stringify(json).length / 4) } };
  }
}
