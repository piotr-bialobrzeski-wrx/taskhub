// Wymiana kodu zgody na token dostępu (PKCE). Token nie wygasa; unieważnia się go w Ustawieniach.
import { corsPreflight, exchangeCode, jsonResponse, oauthErrorResponse, tokenParams } from "@/lib/oauth";

export async function POST(req: Request) {
  try { return jsonResponse(await exchangeCode(await tokenParams(req))); }
  catch (e) { return oauthErrorResponse(e); }
}
export const OPTIONS = corsPreflight;
