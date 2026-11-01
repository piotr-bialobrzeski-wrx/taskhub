// próbki ścieżki M/L/C
export function sample(d: string): [number, number][] {
  const tok = d.match(/[MLC]|-?\d+(\.\d+)?/g)!; const pts: [number, number][] = []; let i = 0, cx = 0, cy = 0;
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    const c = tok[i++];
    if (c === "M" || c === "L") { const x = num(), y = num(); if (c === "L") for (let k = 1; k <= 8; k++) pts.push([cx + ((x - cx) * k) / 8, cy + ((y - cy) * k) / 8]); else pts.push([x, y]); cx = x; cy = y; }
    else { const a = [num(), num()], b = [num(), num()], e = [num(), num()]; for (let k = 1; k <= 24; k++) { const t = k / 24, u = 1 - t; pts.push([u * u * u * cx + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * e[0], u * u * u * cy + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * e[1]]); } cx = e[0]; cy = e[1]; }
  }
  return pts;
}
