import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // pdf-parse (pdfjs) trae un worker (pdf.worker.mjs) que el bundler NO emite
  // dentro de .next/server/chunks — empaquetado truena en producción con
  // "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs".
  // Externalizados, Node los carga de node_modules en runtime, donde el worker
  // sí existe. mammoth va igual por prevención (misma clase de librería).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth"],
};

export default nextConfig;
