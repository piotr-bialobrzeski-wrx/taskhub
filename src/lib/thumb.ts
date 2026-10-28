// Miniatura grafiki (paczka 27): do 640 px szerokości, JPEG; kartka kroku i galeria zadania pokazują ją zamiast pełnego pliku.
import sharp from "sharp";

export const THUMB_W = 640;

export async function makeThumb(data: Buffer): Promise<Buffer | null> {
  const img = sharp(data, { animated: false, limitInputPixels: 80_000_000 }).rotate();
  const meta = await img.metadata();
  if (!meta.width) return null;
  return img.resize({ width: THUMB_W, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 74, mozjpeg: true }).toBuffer();
}
