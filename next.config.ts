import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the Postgres driver and the AI SDKs run only on the server
  serverExternalPackages: ["postgres", "@anthropic-ai/sdk", "openai"],
  // załączniki z doku idą przez akcję serwera; Vercel i tak tnie żądania powyżej 4,5 MB
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // OAuth discovery for MCP clients (RFC 9728 / RFC 8414), with and without the resource path suffix
  // podstawowe nagłówki ochronne: bez osadzania w ramkach (strona zgody konektora), bez zgadywania typów plików, tylko HTTPS
  async headers() {
    // paczka 31, krok 13: podgląd prototypu (/api/preview/<id>) pokazuje się w ramce na kartce decyzji, więc tylko on może być osadzony,
    // i to wyłącznie przez Task Hub (SAMEORIGIN + CSP frame-ancestors 'self' w samej odpowiedzi); reszta dalej DENY
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    ];
    return [
      { source: "/:path((?!api/preview/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, ...common] },
      { source: "/api/preview/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, ...common] },
    ];
  },
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/server" },
    ];
  },
};

export default nextConfig;
