import type { NextConfig } from "next";
 
const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pdf-parse",
    "@napi-rs/canvas",
    "tesseract.js",
    "tesseract.js-core",
    "@tesseract.js-data/eng",
  ],
  // `serverExternalPackages` only tells Next.js not to bundle these
  // packages — it does NOT guarantee Vercel's output file tracer picks up
  // @napi-rs/canvas's native binary (it's a platform-specific .node addon
  // loaded via a dynamic, non-statically-analyzable require). Without this,
  // the function ships without the binary and pdf-parse fails at runtime
  // with "Cannot find module '@napi-rs/canvas'". We explicitly force-include
  // it for the route that performs PDF extraction (upload + reprocess).
  // Same reasoning applies to tesseract.js's WASM core files and the local
  // OCR language data package — both are resolved dynamically at runtime
  // and are not picked up by static analysis.
  outputFileTracingIncludes: {
    "/api/admin/files": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-arm64-gnu/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@tesseract.js-data/**/*",
    ],
  },
};
 
export default nextConfig;
