// Paczka 48: wspólny zapis wzmianki osoby w szkicu `<@aplikacja:id|Imię Nazwisko>`: odczyt, znacznik na kartce, ostrzeżenie o wzmiance bez id.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bareMentions, mentionAt, mentionToken, mentionWarning, mentionsToPlain, parseMentions, replaceMentions } from "@/lib/mention";
import { Markdown } from "@/lib/markdown";

describe("zapis wzmianki", () => {
  it("odczytuje aplikację, id i nazwę, poza kodem", () => {
    expect(parseMentions("Hej <@slack:U09HEQ6BFE3|Piotr Białobrzeski> i <@clickup:81234567|Kinga Nowak>, `<@slack:U2|Kod>`\n```\n<@slack:U3|Blok>\n```")).toEqual([
      { app: "slack", id: "U09HEQ6BFE3", name: "Piotr Białobrzeski" },
      { app: "clickup", id: "81234567", name: "Kinga Nowak" },
    ]);
  });
  it("natywna wzmianka Slacka i kanał zostają zwykłym tekstem", () => {
    expect(parseMentions("<@U07DWN21HJQ> <#C123|dev> <@slack:|Jan>")).toEqual([]);
  });
  it("edytorowa postać z &lt; też jest wzmianką", () => {
    expect(mentionAt("&lt;@whatsapp:+48600100200|Ania> dalej")).toMatchObject({ app: "whatsapp", id: "+48600100200", name: "Ania", raw: "&lt;@whatsapp:+48600100200|Ania>" });
  });
  it("token z danych osoby: nazwa bez znaków zapisu", () => {
    expect(mentionToken({ app: "Slack", id: "U1", name: " Jan | Kowalski>\n" })).toBe("<@slack:U1|Jan Kowalski>");
  });
  it("zamiana na zwykły tekst i na format aplikacji", () => {
    const md = "Cześć <@slack:U1|Jan Kowalski> i <@clickup:9|Ola>, `<@slack:U1|Jan>`";
    expect(mentionsToPlain(md)).toBe("Cześć @Jan Kowalski i @Ola, `<@slack:U1|Jan>`");
    expect(replaceMentions(md, (m) => (m.app === "slack" ? `<@${m.id}>` : null))).toBe("Cześć <@U1> i @Ola, `<@slack:U1|Jan>`");
  });
});

describe("wzmianka bez id", () => {
  it("znajduje @Imię Nazwisko, pomija maile, kod, wzmianki z id i małe litery", () => {
    expect(bareMentions("Hej @Jan Kowalski i @Ola, mail jan@Firma.pl, `@Kod`, <@slack:U1|Ewa Nowak>, @media, <@U123>")).toEqual(["@Jan Kowalski", "@Ola"]);
  });
  it("ostrzeżenie tylko, gdy jest wzmianka bez id", () => {
    expect(mentionWarning(["<@slack:U1|Jan Kowalski>", undefined])).toBeNull();
    const w = mentionWarning(["Cześć @Łukasz Żak"]);
    expect(w).toContain("„@Łukasz Żak”");
    expect(w).toContain("<@aplikacja:id|Imię Nazwisko>");
  });
});

describe("znacznik osoby na kartce", () => {
  it("pokazuje @Imię Nazwisko z aplikacją i id w podpowiedzi, bez surowego zapisu", () => {
    const html = renderToStaticMarkup(<Markdown text={"Hej <@slack:U1|Jan Kowalski>, **ważne**"} />);
    expect(html).toContain('<span class="mention-tag" title="slack · U1" data-app="slack" data-id="U1">@Jan Kowalski</span>');
    expect(html).toContain("<b>ważne</b>");
    expect(html).not.toContain("&lt;@slack");
  });
});
