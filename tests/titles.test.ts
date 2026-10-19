import { describe, it, expect } from "vitest";
import { isLongTitle } from "@/lib/agent/work";

describe("krótkie tytuły zadań", () => {
  it("cała wiadomość Piotra jako tytuł idzie do skrócenia, krótki tytuł nie", () => {
    expect(isLongTitle("Zmieniłem, wprowadziłem zmiany w prototypie kroku employees do onboardingu. Te zmiany są opisane")).toBe(true);
    expect(isLongTitle("Wyślij behawiorystce wideo z zachowaniem piesków")).toBe(false);
    expect(isLongTitle("Kup patelnię ceramiczną GreenPan 28 cm")).toBe(false);
    expect(isLongTitle("Zrób to. Potem tamto")).toBe(true);
  });
});
