import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the Postgres driver and the AI SDKs run only on the server
  serverExternalPackages: ["postgres", "@anthropic-ai/sdk", "openai"],
};

export default nextConfig;
