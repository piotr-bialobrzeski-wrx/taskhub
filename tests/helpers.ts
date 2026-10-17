// Pomocnicze: dane testowe bez bazy i sztuczny dostawca modelu.
import type { Step, Task, Project, Rule } from "@/lib/schema";
import type { AiProvider, GenerateJsonOptions } from "@/lib/ai/provider";
import { AiError } from "@/lib/ai/provider";

let n = 0;
export const step = (p: Partial<Step> = {}): Step => ({
  id: "s" + ++n, taskId: "t1", position: n, title: "Krok " + n, detail: "", tool: "manual", status: "todo", prevStatus: null, needsApproval: false,
  estMin: 15, spentSec: 0, spentManual: false, link: null, handoffAt: null, report: null, output: "", review: null, blocks: null, blocksAt: null, logged: false, pos: null, dependsOn: [], ...p,
});
export const task = (p: Partial<Task> = {}): Task => ({
  id: "t" + ++n, ownerId: "o", projectId: null, title: "Zadanie", summary: "", source: "", level: 3, due: null, doneAt: null, deletedAt: null,
  noteText: null, noteSummary: null, noteAt: null, pos: null, createdAt: new Date().toISOString(), dependsOn: [], steps: [step()], ...p,
});
export const rule = (p: Partial<Rule> = {}): Rule => ({ id: "r" + ++n, kind: "rule", scope: "global", companyId: null, projectId: null, tool: null, originCompanyId: null, title: "Zasada", body: "Treść", trigger: null, summary: null, visibility: "private", ...p });
export const project = (p: Partial<Project> = {}): Project => ({ id: "p1", name: "Projekt", color: 0, weight: 3, language: "pl", companyId: null, ...p });

// sztuczny dostawca: zwraca kolejne odpowiedzi z kolejki, sprawdzone schematem jak u prawdziwego
export class FakeProvider implements AiProvider {
  readonly model = "fake";
  calls: GenerateJsonOptions<unknown>[] = [];
  constructor(readonly name: "anthropic" | "openai", private queue: unknown[] = [], private failWith?: AiError) {}
  push(v: unknown) { this.queue.push(v); return this; }
  async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    this.calls.push(opts as GenerateJsonOptions<unknown>);
    if (this.failWith) throw this.failWith;
    const v = this.queue.shift();
    if (v === undefined) throw new Error("FakeProvider: brak odpowiedzi w kolejce");
    return opts.schema.parse(v);
  }
}
