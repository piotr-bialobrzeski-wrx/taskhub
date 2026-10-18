// Czas w interfejsie: zawsze strefa Europe/Warsaw (serwer na Vercelu liczy w UTC, więc bez tego panel pokazywał godziny o dwie wstecz),
// oraz kiedy automat co godzinę zajrzy następnym razem (cron „7 7-22 * * *” w Warszawie).
export const TZ = "Europe/Warsaw";
export const fmtTime = (iso: string | Date) => new Date(iso).toLocaleTimeString("pl-PL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fmtDate = (iso: string | Date) => new Date(iso).toLocaleDateString("pl-PL", { timeZone: TZ, day: "numeric", month: "short" });
export const fmtDateLong = (iso: string | Date) => new Date(iso).toLocaleDateString("pl-PL", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
export const fmtDateTime = (iso: string | Date) => new Date(iso).toLocaleString("pl-PL", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
// dzień w Warszawie jako YYYY-MM-DD: do porównań „dziś / wczoraj”
export const dayKey = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export function warsawParts(now: Date = new Date()): { h: number; m: number } {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { h: get("hour") % 24, m: get("minute") };
}

export const AUTO_MINUTE = 7, AUTO_FROM = 7, AUTO_TO = 22;   // automat: minuta 7 każdej godziny od 7:07 do 22:07
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
// najbliższe uruchomienie automatu: „09:07” albo „jutro 07:07”
export function nextAutoAt(now: Date = new Date()): { time: string; tomorrow: boolean; text: string } {
  const { h, m } = warsawParts(now);
  let nh: number, tomorrow = false;
  if (h < AUTO_FROM) nh = AUTO_FROM;
  else if (h > AUTO_TO || (h === AUTO_TO && m >= AUTO_MINUTE)) { nh = AUTO_FROM; tomorrow = true; }
  else nh = m < AUTO_MINUTE ? h : h + 1;
  const time = hhmm(nh, AUTO_MINUTE);
  return { time, tomorrow, text: tomorrow ? `jutro o ${time}` : `o ${time}` };
}
