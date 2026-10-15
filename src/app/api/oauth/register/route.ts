// RFC 7591: klient (aplikacja Claude, ChatGPT, Claude Code) rejestruje się sam przed pierwszym połączeniem.
import { corsPreflight, jsonResponse, oauthErrorResponse, registerClient } from "@/lib/oauth";

export async function POST(req: Request) {
  try { return jsonResponse(await registerClient(await req.json().catch(() => null)), 201); }
  catch (e) { return oauthErrorResponse(e); }
}
export const OPTIONS = corsPreflight;
