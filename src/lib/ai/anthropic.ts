import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AiError, type AiProvider, type GenerateJsonOptions } from "./provider";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
  }

  async generateJson<T>(o: GenerateJsonOptions<T>): Promise<T> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(o.images ?? []).map((img): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } })),
      { type: "text", text: o.prompt },
    ];
    try {
      // fallbacks: "default" - gdy klasyfikator bezpieczeństwa odrzuci prośbę, API samo ponawia ją na modelu zapasowym
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: o.maxTokens ?? 16000,
        system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
        output_config: { format: zodOutputFormat(o.schema), effort: o.effort ?? "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (res.stop_reason === "refusal") throw new AiError("Model odmówił odpowiedzi", this.name, false);
      if (res.stop_reason === "max_tokens") throw new AiError("Odpowiedź modelu była za długa", this.name, false);
      if (res.parsed_output == null) throw new AiError("Model nie zwrócił poprawnego JSON", this.name, true);
      return res.parsed_output as T;
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AiError("Zły klucz Anthropic", this.name, false, e);
      if (e instanceof Anthropic.RateLimitError) throw new AiError("Limit zapytań Anthropic", this.name, true, e);
      if (e instanceof Anthropic.BadRequestError) throw new AiError("Błędne zapytanie do Anthropic: " + e.message, this.name, false, e);
      if (e instanceof Anthropic.APIConnectionError) throw new AiError("Brak połączenia z Anthropic", this.name, true, e);
      if (e instanceof Anthropic.APIError) throw new AiError(`Błąd Anthropic ${e.status}`, this.name, (e.status ?? 500) >= 500, e);
      throw new AiError("Nieznany błąd Anthropic", this.name, true, e);
    }
  }
}
