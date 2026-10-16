// Początek biegu: mostek bierze pracę na wyłączność (jeden otwarty bieg na właściciela) i dostaje prompt oraz adres konektora.
import * as repo from "@/lib/repo";
import { RUN_MAX_MIN, RUN_STALE_MIN, authBridge, bridgePrompt, mcpUrl } from "@/lib/bridge";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const body = (await req.json().catch(() => ({}))) as { bridge?: string };
  await repo.expireBridgeRuns(a.ownerId, RUN_STALE_MIN);
  const run = await repo.startBridgeRun(a.ownerId, a.tokenId, String(body.bridge || a.name || "mostek"));
  if (!run) {
    const st = await repo.bridgeStatus(a.ownerId, 0);
    return Response.json({ busy: true, run: st.run }, { status: 409 });
  }
  return Response.json({ run, prompt: bridgePrompt(), mcp: mcpUrl(), maxMinutes: RUN_MAX_MIN, staleMinutes: RUN_STALE_MIN });
}
