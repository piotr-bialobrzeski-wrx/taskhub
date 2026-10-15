// Warstwa modelu niezależna od dostawcy. Aplikacja prosi o JSON zgodny ze schematem,
// a dostawca (Claude albo GPT) jest wymienny i wybierany konfiguracją.
import type { z } from "zod";

export type ImageInput = { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; base64: string };

export type GenerateJsonOptions<T> = {
  system: string;                 // stała część (zasady, instrukcje), dobra do cache'owania
  prompt: string;                 // zmienna część
  schema: z.ZodType<T>;
  images?: ImageInput[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

export interface AiProvider {
  readonly name: "anthropic" | "openai";
  readonly model: string;
  generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T>;
}

export class AiError extends Error {
  constructor(message: string, public readonly provider: string, public readonly retryable: boolean, public readonly cause?: unknown) { super(message); }
}
