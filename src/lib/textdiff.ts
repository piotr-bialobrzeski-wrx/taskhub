// Porównanie słów dwóch wersji tej samej treści (obecna i nowa, paczka 49 punkt 3): które słowa obecnej wersji znikają, a które w nowej
// dochodzą. Czysta logika bez DOM: kartka podświetla te słowa w obu kolumnach porównania. Słowa porównują się bez interpunkcji na brzegach
// i bez wielkości liter, żeby „story.” i „Story” nie świeciły się jako zmiana.
const key = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || w;
// najdłuższy wspólny podciąg na środku (po odcięciu wspólnego początku i końca); dłuższy środek to zmiana całości, bez pomiaru słowo po słowie
const MAX = 2500;

export function changedWords(a: string[], b: string[]): { del: boolean[]; ins: boolean[] } {
  const del = a.map(() => false), ins = b.map(() => false);
  const ka = a.map(key), kb = b.map(key);
  let s = 0;
  while (s < ka.length && s < kb.length && ka[s] === kb[s]) s++;
  let ea = ka.length, eb = kb.length;
  while (ea > s && eb > s && ka[ea - 1] === kb[eb - 1]) { ea--; eb--; }
  const n = ea - s, m = eb - s;
  if (!n || !m || n > MAX || m > MAX) {
    for (let i = s; i < ea; i++) del[i] = true;
    for (let j = s; j < eb; j++) ins[j] = true;
    return { del, ins };
  }
  // tablica długości wspólnego podciągu od końca: L[i][j] dla a[s+i..], b[s+j..]
  const w = m + 1, L = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * w + j] = ka[s + i] === kb[s + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[s + i] === kb[s + j]) { i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) del[s + i++] = true;
    else ins[s + j++] = true;
  }
  while (i < n) del[s + i++] = true;
  while (j < m) ins[s + j++] = true;
  return { del, ins };
}

// słowa tekstu z ich położeniem (początek, koniec): z tych samych kawałków tekstu, które widzi Piotr
export function wordsOf(text: string): { w: string; from: number; to: number }[] {
  const out: { w: string; from: number; to: number }[] = [];
  for (const m of text.matchAll(/\S+/g)) out.push({ w: m[0], from: m.index!, to: m.index! + m[0].length });
  return out;
}
