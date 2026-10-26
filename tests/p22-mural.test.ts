import { describe, expect, it } from "vitest";
import { connectorProblem, knownApp, sendPrompt, sendServers } from "@/lib/bridge";
import { appName, appOfLabel, inApp, openLabel, toolLabel, type Connection } from "@/lib/schema";

// paczka 22: Mural jak każda aplikacja z konektorem: konektor claude.ai na Macu → rejestr → szkic zmian tablicy → bieg wysyłki tylko tym konektorem
describe("Mural przez konektor na Macu", () => {
  const c = (o: Partial<Connection>): Connection => ({ id: "x", app: "mural", label: "Mural", account: null, companyId: null, sphere: "work", provider: "claude", kind: "mcp", state: "active", source: "bridge", host: "mini", url: null, meta: {}, seenAt: null, ...o });
  const t = { app: "mural", connectionId: null, host: null, companyId: null };

  it("nazwa konektora i etykiety", () => {
    expect(appOfLabel("Mural")).toBe("mural");
    expect(appOfLabel("claude.ai Mural")).toBe("mural");
    expect(toolLabel("mural")).toBe("Mural");
    expect(appName("mural")).toBe("Mural");
    expect(inApp("mural")).toBe("w Muralu");
    expect(openLabel("mural")).toBe("Otwórz w Muralu");
  });

  it("wysyłka idzie konektorem z rejestru; bez niego karta mówi, czego brakuje", () => {
    const conns = [c({ id: "m1", meta: { server: "claude.ai Mural" } }), c({ id: "f1", app: "figma", label: "Figma", meta: { server: "claude.ai Figma" } })];
    expect(knownApp(conns, "mural")).toBe(true);
    expect(sendServers(conns, t)).toEqual(["claude.ai Mural"]);
    expect(connectorProblem(conns, t)).toBeNull();
    expect(connectorProblem([conns[1]], t)).toMatchObject({ kind: "none" });
    expect(connectorProblem([c({ meta: { server: "claude.ai Mural" }, state: "off" })], t)).toMatchObject({ kind: "none" });
  });

  it("bieg wysyłki robi komplet zmian tablicy raz, tylko konektorem Muralu", () => {
    const p = sendPrompt({ stepId: "S1", taskId: "T1", app: "mural", action: "update", servers: ["claude.ai Mural"] });
    expect(p).toContain("wyłącznie konektorem „claude.ai Mural”");
    expect(p).toContain("(Mural, czynność update)");
    expect(p).toContain("zmiany na tablicy");
    expect(p).toContain("jeden komplet zmian ze szkicu");
  });
});
