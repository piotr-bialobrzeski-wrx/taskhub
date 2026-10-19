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
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ],
    }];
  },
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/server" },
    ];
  },
};

export default nextConfig;
