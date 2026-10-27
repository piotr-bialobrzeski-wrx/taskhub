// szkic niewysłanej wiadomości w polu czatu (paczka 19, punkt 3; poprawka paczki 22): osobno dla każdego miejsca czatu (główna kanwa, zadanie, krok),
// w przeglądarce, więc przetrwa przejście do innego zadania i odświeżenie strony; znika w chwili wysłania i wraca tylko, gdy wysłanie się nie uda
export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const local = (): DraftStore | null => { try { return localStorage; } catch { return null; } };

export const draftKeyOf = (taskId: string | null, stepId: string | null) => "th-draft-" + (!taskId ? "main" : stepId ? "s-" + stepId : "t-" + taskId);
export const readDraft = (key: string, store = local()) => { try { return store?.getItem(key) ?? ""; } catch { return ""; } };
export const writeDraft = (key: string, v: string, store = local()) => { try { if (v.trim()) store?.setItem(key, v); else store?.removeItem(key); } catch { /* brak storage */ } };

// przekierowanie z akcji serwera (np. do nowego zadania) to udane wysłanie, nie błąd
export const isRedirect = (e: unknown) => { const d = (e as { digest?: unknown } | null)?.digest; return typeof d === "string" && d.startsWith("NEXT_REDIRECT"); };

export type Sent = { key: string; text: string; failed: boolean };
// szkic znika przed wysłaniem, a nie po nim: wysłanie często przenosi do innego zadania i wtedy to pole nie dożywa końca wysyłki
// (tak tekst wracał po wysłaniu z kontekstem „wszystkie zadania”, zgłoszenie z 2026-10-26); przy błędzie szkic wraca
export async function sendKeepingDraft(action: (fd: FormData) => Promise<void>, fd: FormData, key: string, store = local()): Promise<Sent> {
  const sent: Sent = { key, text: String(fd.get("text") ?? ""), failed: false };
  writeDraft(key, "", store);
  try { await action(fd); }
  catch (e) {
    if (isRedirect(e)) throw e;
    sent.failed = true;
    writeDraft(key, sent.text, store);
  }
  return sent;
}
