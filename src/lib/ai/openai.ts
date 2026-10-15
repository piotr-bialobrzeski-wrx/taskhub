import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { AiError, type AiProvider, type GenerateJsonOptions } from "./provider";

export class OpenAIProvider implements AiProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private client: OpenAI;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new OpenAI(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-5";
  }

  async generateJson<T>(o: GenerateJsonOptions<T>): Promise<T> {
    const content: OpenAI.Responses.ResponseInputContent[] = [
      ...(o.images ?? []).map((img): OpenAI.Responses.ResponseInputImage => ({ type: "input_image", image_url: `data:${img.mediaType};base64,${img.base64}`, detail: "auto" })),
      { type: "input_text", text: o.prompt },
    ];
    try {
      const res = await this.client.responses.parse({
        model: this.model,
        instructions: o.system,
        input: [{ role: "user", content }],
        text: { format: zodTextFormat(o.schema as z.ZodObject, "result") },
        max_output_tokens: o.maxTokens ?? 16000,
        reasoning: { effort: o.effort ?? "medium" },
      });
      if (res.output_parsed == null) throw new AiError("Model nie zwrócił poprawnego JSON", this.name, true);
      return res.output_parsed as T;
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (e instanceof OpenAI.AuthenticationError) throw new AiError("Zły klucz OpenAI", this.name, false, e);
      if (e instanceof OpenAI.RateLimitError) throw new AiError("Limit zapytań OpenAI", this.name, true, e);
      if (e instanceof OpenAI.BadRequestError) throw new AiError("Błędne zapytanie do OpenAI: " + e.message, this.name, false, e);
      if (e instanceof OpenAI.APIConnectionError) throw new AiError("Brak połączenia z OpenAI", this.name, true, e);
      if (e instanceof OpenAI.APIError) throw new AiError(`Błąd OpenAI ${e.status}`, this.name, (e.status ?? 500) >= 500, e);
      throw new AiError("Nieznany błąd OpenAI", this.name, true, e);
    }
  }
}
