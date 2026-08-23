import type { NextConfig } from "next";

function configuredDevOrigin() {
  const value = process.env.TEMPORAL_APP_URL;
  if (!value) return [];
  try { return [new URL(value).hostname]; }
  catch { return []; }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: configuredDevOrigin(),
};

export default nextConfig;
