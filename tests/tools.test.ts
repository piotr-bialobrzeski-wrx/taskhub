// Klucze narzędzi: etykieta albo alias z konektora („Claude Code”, „Ty”) ma trafić do bazy jako klucz, bo kolor chipa i kalibracja czasu idą po kluczu.
import { describe, it, expect } from "vitest";
import { normalizeTool, toolLabel, TOOL_KEYS, TOOL_LABELS } from "@/lib/schema";

describe("klucz narzędzia", () => {
  it("etykiety i aliasy zamienia na klucze, klucze zostawia, puste daje domyślne", () => {
    expect(normalizeTool("Claude Code")).toBe("code");
    expect(normalizeTool("claude-code")).toBe("code");
    expect(normalizeTool("claude_code")).toBe("code");
    expect(normalizeTool("CODE")).toBe("code");
    expect(normalizeTool("Ty")).toBe("manual");
    expect(normalizeTool("Piotr")).toBe("manual");
    expect(normalizeTool("E-mail")).toBe("gmail");
    expect(normalizeTool("mail")).toBe("gmail");
    expect(normalizeTool("git")).toBe("github");
    expect(normalizeTool("Dokument")).toBe("claude");
    expect(normalizeTool(" Slack ")).toBe("slack");
    expect(normalizeTool("")).toBe("manual");
    expect(normalizeTool(null)).toBe("manual");
    expect(normalizeTool(undefined, "code")).toBe("code");
    expect(normalizeTool("Notion")).toBe("notion");   // nieznane narzędzie zostaje, tylko małymi literami
  });
  it("każda etykieta z listy wraca do swojego klucza (poza „Claude”, które jest też kluczem dokumentu)", () => {
    for (const k of TOOL_KEYS) {
      const l = toolLabel(k).toLowerCase();
      if (TOOL_LABELS[l]) continue;   // „claude” to klucz dokumentu; etykieta aplikacji Claude nie może go przykryć
      expect(normalizeTool(toolLabel(k))).toBe(k);
    }
  });
});
