// RFC 8414: metadane serwera autoryzacji (/.well-known/oauth-authorization-server, przepisane w next.config.ts).
import { corsPreflight, jsonResponse, originOf, serverMetadata } from "@/lib/oauth";

export const GET = (req: Request) => jsonResponse(serverMetadata(originOf(req)));
export const OPTIONS = corsPreflight;
