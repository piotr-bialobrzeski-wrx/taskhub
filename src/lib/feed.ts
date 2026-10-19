// Dymki agenta w prawym dolnym rogu: ostatnie odpowiedzi z historii rozmowy (najnowsza na dole), tylko świeże, żeby rano nie wracały wczorajsze
import { fmtTime } from "./clock";
import type { ChatMessage } from "./repo";

export type FeedItem = { id: string; text: string; at: string; stepId: string | null; link: string | null };
export const FEED_MAX = 3;
const FRESH_MS = 12 * 3600_000;

export function agentFeed(log: ChatMessage[], now = Date.now()): FeedItem[] {
  return log.filter((m) => m.role === "agent" && now - new Date(m.createdAt).getTime() < FRESH_MS).slice(-FEED_MAX).map((m) => {
    const a = (m.actions ?? null) as { stepId?: string; link?: string } | null;
    return { id: m.id, text: m.text, at: fmtTime(m.createdAt), stepId: a?.stepId ?? null, link: a?.link ?? null };
  });
}
