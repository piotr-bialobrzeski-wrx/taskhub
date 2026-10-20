// Typy dla skryptu mostka (czysty ESM bez TypeScriptu), żeby testy mogły go importować.
declare module "*taskhub-bridge.mjs" {
  export const VERSION: string;
  export const ALLOWED_TOOLS: string[];
  export const DISALLOWED_TOOLS: string[];
  export const SCRIPT_NOTE: string;
  export function parseLimit(text: unknown): { limit: boolean; reset_at: number | null };
  export function parseAuth(text: unknown): boolean;
  export function parseArgs(argv: string[]): Record<string, string | boolean | string[]>;
  export function loadConfig(args?: Record<string, unknown>, env?: Record<string, string | undefined>, file?: Record<string, unknown>): Record<string, any>;
  export function permissionMode(p: unknown): string;
  export function writeMcpConfig(dir: string, id: string, mcp: string, token: string): string;
  export function claudeArgs(prompt: string, cfg: Record<string, any>, mcpFile: string): string[];
  export function runnerCommand(cfg: Record<string, any>, prompt: string, mcp: string, mcpFile?: string): { bin: string; args: string[]; json: boolean };
  export function plistFor(o: { node: string; script: string; log: string; dir: string }): string;
  export function findClaude(cfg: Record<string, any>): string;
  export function runProcess(bin: string, args: string[], o: { cwd: string; onStep: (s: string) => void; maxMs: number; json: boolean; env?: Record<string, string> }): Promise<{ ok: boolean; reply?: string; error?: string }>;
}
