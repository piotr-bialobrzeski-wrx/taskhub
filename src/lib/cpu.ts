// Paczka 60: licznik procesora na Vercelu. Jedna linia w Logs na wywołanie: „[cpu] trasa ms=…”, żeby było widać, która trasa zjada limit.
// process.cpuUsage liczy cały proces, więc przy kilku równoległych wywołaniach w jednej instancji liczba jest przybliżona (do porównań, nie do faktury).
export const cpuStart = () => process.cpuUsage();
export function cpuLog(route: string, start: NodeJS.CpuUsage, extra = ""): void {
  const d = process.cpuUsage(start);
  console.log(`[cpu] ${route} ms=${Math.round((d.user + d.system) / 1000)}${extra ? " " + extra : ""}`);
}
