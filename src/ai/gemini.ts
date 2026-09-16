import { GoogleGenAI } from '@google/genai';
import type { CompletionRequest, CompletionResult, Provider } from './provider';
import { cleanSchema } from './schema-util';

/** JSON mode with a response JSON schema. The SDK accepts standard JSON Schema through responseJsonSchema. */
export class GeminiProvider implements Provider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;
  constructor(apiKey: string, readonly model: string) { this.client = new GoogleGenAI({ apiKey }); }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const t0 = Date.now();
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: req.user,
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: cleanSchema(req.schema),
        maxOutputTokens: req.maxTokens,
        httpOptions: { timeout: 60_000 },
      },
    });
    const text = response.text;
    if (!text) throw new Error('gemini: empty response');
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { __unparseable: text.slice(0, 200) }; }
    const u = response.usageMetadata;
    return { json, latencyMs: Date.now() - t0, usage: { input: u?.promptTokenCount ?? 0, output: u?.candidatesTokenCount ?? 0 } };
  }
}
