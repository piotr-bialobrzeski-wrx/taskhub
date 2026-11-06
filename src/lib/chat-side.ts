// Panel czatu po lewej w widoku kroku (paczka 52): szerokość i stan pokazany/schowany zapamiętane w przeglądarce.
// Tylko na szerokim ekranie (od 861 px); na telefonie czat zostaje warstwą nad kartką (szuflada kroku).

export const CHAT_W_DEFAULT = 380;   // standardowa szerokość panelu
export const CHAT_W_MIN = 300;
export const CHAT_W_MAX = 720;
export const CHAT_SIDE_MIN_VW = 861; // ta sama granica co szuflada kroku w globals.css (max-width: 860px)
const KEY_W = "th.stepchat.w";
const KEY_OPEN = "th.stepchat.open";

// szerokość w granicach: najmniej 300 px, najwięcej 720 px i nie więcej niż połowa okna (kartka zawsze ma miejsce)
export function clampChatW(w: number, vw: number): number {
  const max = Math.max(CHAT_W_MIN, Math.min(CHAT_W_MAX, Math.floor(vw / 2)));
  if (!Number.isFinite(w)) return Math.min(CHAT_W_DEFAULT, max);
  return Math.round(Math.min(max, Math.max(CHAT_W_MIN, w)));
}

type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };

export function readChatSide(s: Store | null = store()): { w: number; open: boolean } {
  let w = CHAT_W_DEFAULT, open = true;
  try {
    const rw = s?.getItem(KEY_W); if (rw != null && rw !== "" && Number.isFinite(Number(rw))) w = Number(rw);
    const ro = s?.getItem(KEY_OPEN); if (ro === "0") open = false;
  } catch { /* prywatne okno albo zablokowane dane: wartości domyślne */ }
  return { w, open };
}

export function writeChatSide(v: { w?: number; open?: boolean }, s: Store | null = store()): void {
  try {
    if (v.w != null) s?.setItem(KEY_W, String(Math.round(v.w)));
    if (v.open != null) s?.setItem(KEY_OPEN, v.open ? "1" : "0");
  } catch { /* bez zapisu: panel działa, tylko nie pamięta */ }
}
