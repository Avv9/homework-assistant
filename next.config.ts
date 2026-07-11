import type { NextConfig } from "next";
 
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  // `serverExternalPackages` only tells Next.js not to bundle these
  // packages — it does NOT guarantee Vercel's output file tracer picks up
  // @napi-rs/canvas's native binary (it's a platform-specific .node addon
  // loaded via a dynamic, non-statically-analyzable require). Without this,
  // the function ships without the binary and pdf-parse fails at runtime
  // with "Cannot find module '@napi-rs/canvas'". We explicitly force-include
  // it for the route that performs PDF extraction (upload + reprocess).
  outputFileTracingIncludes: {
    "/api/admin/files": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-arm64-gnu/**/*",
    ],
  },
};
 
export default nextConfig;
