import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, CompletionResult, Provider } from './provider';
import { cleanSchema } from './schema-util';

/** One forced tool call named `report` whose input schema is the requested output schema. Prose cannot leak: only the tool input is returned. */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;
  constructor(apiKey: string, readonly model: string) { this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }); }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const t0 = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      // Forced tool choice is incompatible with thinking; the reviewer's value is in the structured output, not the scratchpad.
      thinking: { type: 'disabled' },
      tools: [{ name: 'report', description: 'Return the structured review. This is the only permitted output.', input_schema: cleanSchema(req.schema) as Anthropic.Tool['input_schema'] }],
      tool_choice: { type: 'tool', name: 'report' },
      messages: [{ role: 'user', content: req.user }],
    });
    const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!block) throw new Error(`anthropic: no tool_use block in response (stop_reason ${response.stop_reason})`);
    return { json: block.input, latencyMs: Date.now() - t0, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
  }
}
