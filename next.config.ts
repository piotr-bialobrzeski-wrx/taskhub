import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the Postgres driver and the AI SDKs run only on the server
  serverExternalPackages: ["postgres", "@anthropic-ai/sdk", "openai"],
  // OAuth discovery for MCP clients (RFC 9728 / RFC 8414), with and without the resource path suffix
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/server" },
    ];
  },
};

export default nextConfig;
