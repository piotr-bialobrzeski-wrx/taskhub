// Wybór dostawcy: ustawienie użytkownika > AI_PROVIDER > pierwszy skonfigurowany klucz.
// Gdy wybrany dostawca zawiedzie błędem przejściowym, próbujemy drugiego (o ile ma klucz).
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { AiError, type AiProvider, type GenerateJsonOptions } from "./provider";

export type ProviderName = "anthropic" | "openai";

export function availableProviders(): ProviderName[] {
  const out: ProviderName[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (process.env.OPENAI_API_KEY) out.push("openai");
  return out;
}

function make(name: ProviderName): AiProvider {
  return name === "anthropic" ? new AnthropicProvider() : new OpenAIProvider();
}

export function pickProvider(preferred?: string | null): AiProvider | null {
  const avail = availableProviders();
  if (!avail.length) return null;
  const want = (preferred ?? process.env.AI_PROVIDER ?? avail[0]) as ProviderName;
  return make(avail.includes(want) ? want : avail[0]);
}

export class Ai {
  constructor(private preferred?: string | null, private overrides?: Partial<Record<ProviderName, AiProvider>>) {}
  get provider(): AiProvider | null { return this.overrides?.[(this.preferred ?? process.env.AI_PROVIDER ?? "anthropic") as ProviderName] ?? pickProvider(this.preferred); }
  get enabled(): boolean { return !!this.provider; }

  async json<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    const primary = this.provider;
    if (!primary) throw new AiError("Brak skonfigurowanego dostawcy modelu (ANTHROPIC_API_KEY albo OPENAI_API_KEY)", "none", false);
    try {
      return await primary.generateJson(opts);
    } catch (e) {
      const other = availableProviders().find((n) => n !== primary.name);
      if (e instanceof AiError && e.retryable && other) {
        const backup = this.overrides?.[other] ?? make(other);
        return backup.generateJson(opts);
      }
      throw e;
    }
  }
}

export { AiError } from "./provider";
export type { AiProvider, GenerateJsonOptions, ImageInput } from "./provider";
