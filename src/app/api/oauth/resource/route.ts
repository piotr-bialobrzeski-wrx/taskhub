// RFC 9728: metadane chronionego zasobu (/.well-known/oauth-protected-resource, przepisane w next.config.ts).
import { corsPreflight, jsonResponse, originOf, resourceMetadata } from "@/lib/oauth";

export const GET = (req: Request) => jsonResponse(resourceMetadata(originOf(req)));
export const OPTIONS = corsPreflight;
