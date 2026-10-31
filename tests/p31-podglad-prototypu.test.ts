// Paczka 31, krok 13: prototyp w okienku na kartce decyzji; które adresy da się osadzić
import { describe, expect, it } from "vitest";
import { embedMode, frameAllowed, publicHttpsUrl } from "@/lib/embed";

const APP = "https://taskhub-lac.vercel.app";
const ID = "0b8c8e1e-7a7b-4c2d-9a1e-2f3b4c5d6e7f";

describe("embedMode", () => {
  it("podgląd Task Hub osadza się od razu", () => {
    expect(embedMode(`${APP}/api/preview/${ID}`, APP)).toBe("frame");
    expect(embedMode(`/api/preview/${ID}`, APP)).toBe("frame");
  });
  it("inne strony Task Hub i znane blokowane adresy zostają linkiem", () => {
    expect(embedMode(`${APP}/tasks/${ID}`, APP)).toBe("link");
    expect(embedMode("https://claude.ai/artifact/X949DT6kPt6pw4Rs9Yfe2L", APP)).toBe("link");
    expect(embedMode("https://claude.ai/code/artifact/fcba7f2e", APP)).toBe("link");
    expect(embedMode("https://github.com/a/b", APP)).toBe("link");
    expect(embedMode("http://example.com/p.html", APP)).toBe("link");
    expect(embedMode("file:///Users/x/p.html", APP)).toBe("link");
    expect(embedMode(null, APP)).toBe("link");
  });
  it("obcą stronę https sprawdza serwer", () => {
    expect(embedMode("https://proto-abc.vercel.app/", APP)).toBe("check");
  });
});

describe("frameAllowed", () => {
  it("frame-ancestors decyduje przed X-Frame-Options", () => {
    expect(frameAllowed({ csp: "frame-ancestors 'self' chrome-extension://x; frame-src a" }, APP)).toBe(false);
    expect(frameAllowed({ csp: "default-src 'self'; frame-ancestors *", xfo: "DENY" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors https://*.vercel.app" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors https://taskhub-lac.vercel.app" }, APP)).toBe(true);
    expect(frameAllowed({ csp: "frame-ancestors 'none'" }, APP)).toBe(false);
  });
  it("X-Frame-Options blokuje, brak nagłówków pozwala", () => {
    expect(frameAllowed({ xfo: "DENY" }, APP)).toBe(false);
    expect(frameAllowed({ xfo: "sameorigin" }, APP)).toBe(false);
    expect(frameAllowed({}, APP)).toBe(true);
  });
});

describe("publicHttpsUrl", () => {
  it("odrzuca sieć prywatną i nie-https", () => {
    for (const u of ["http://example.com", "https://localhost/x", "https://127.0.0.1/", "https://10.0.0.2/", "https://192.168.1.1/", "https://169.254.169.254/", "https://[::1]/", "https://intranet/", "https://a:b@example.com/"])
      expect(publicHttpsUrl(u), u).toBeNull();
    expect(publicHttpsUrl("https://proto.example.com/a")?.hostname).toBe("proto.example.com");
  });
});
