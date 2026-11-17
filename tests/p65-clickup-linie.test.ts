import { describe, it, expect } from "vitest";
import { clickupMd, publishFormat } from "@/lib/format";
import { draftsText } from "@/lib/agent/context";

// paczka 65: ClickUp każdą pustą linię pokazuje jako pusty akapit (zrzut opisu „Attendance Issues Details widget”)
const story = [
  "# Description",
  "",
  "This story adds the Attendance Issues Detail table.",
  "Out of scope:",
  "",
  "- The PDF export of the table.",
  "- The XLSX export of the table.",
  "",
  "# Story",
  "",
  "As a manager, I want to see every attendance issue in one table.",
  "",
  "# Acceptance criteria",
  "",
  "**A: The new table**",
  "",
  "1. User opens the report → the report shows the table.",
  "2. There are no issues → the widget shows the empty state.",
  "",
].join("\n");

describe("tekst do ClickUpa bez pustych akapitów", () => {
  it("opis z nagłówkami, akapitem, listą punktowaną i numerowaną: nowa linia to jedna linia niżej, bez pustych linii", () => {
    expect(clickupMd(story)).toBe([
      "# Description",
      "This story adds the Attendance Issues Detail table.",
      "Out of scope:",
      "- The PDF export of the table.",
      "- The XLSX export of the table.",
      "# Story",
      "As a manager, I want to see every attendance issue in one table.",
      "# Acceptance criteria",
      "**A: The new table**",
      "1. User opens the report → the report shows the table.",
      "2. There are no issues → the widget shows the empty state.",
    ].join("\n"));
  });
  it("pusta linia zostaje tylko tam, gdzie bez niej tekst dokleiłby się do punktu listy, cytatu albo tabeli", () => {
    expect(clickupMd("1. jeden\n2. dwa\n\n**B: Table behavior**\n\n3. trzy")).toBe("1. jeden\n2. dwa\n\n**B: Table behavior**\n3. trzy");
    expect(clickupMd("- a\n  dalej a\n\nAkapit")).toBe("- a\n  dalej a\n\nAkapit");
    expect(clickupMd("> cytat\n\nAkapit")).toBe("> cytat\n\nAkapit");
    expect(clickupMd("Tekst\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nPod tabelą")).toBe("Tekst\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nPod tabelą");
    expect(clickupMd("- a\n\n## Nagłówek\n\n- b")).toBe("- a\n## Nagłówek\n- b");
  });
  it("kilka pustych linii, puste linie na początku i końcu znikają; kod w ogrodzeniu zostaje bajt w bajt", () => {
    expect(clickupMd("\n\nA\n\n\n\nB\n\n")).toBe("A\nB");
    expect(clickupMd("Przed\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nPo")).toBe("Przed\n```ts\nconst a = 1;\n\nconst b = 2;\n```\nPo");
  });
  it("publishFormat i get_task dają wersję dla ClickUpa; ten sam tekst idzie do opisu i do komentarza", () => {
    const f = publishFormat("clickup", story)!;
    expect(f.text).toBe(clickupMd(story));
    expect(f.how).toContain("pusty akapit");
    expect(publishFormat("clickup", "Jedna linia")!.text).toBeNull();
    for (const action of ["update", "comment"] as const) {
      const out = draftsText([{ id: "s1", title: "Opis", status: "handoff", blocks: [{ type: "draft", target: { app: "clickup", where: "Reports", action }, body: story, status: "approved" }] }]);
      expect(out).toContain(`- treść jako Markdown dla ClickUpa (wyślij tę wersję):\n---\n${clickupMd(story)}\n---`);
    }
  });
  it("Slack i mail bez zmian", () => {
    expect(publishFormat("slack", story)!.text).toBeNull();
  });
});
