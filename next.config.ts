import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Raíz del workspace FIJA: en producción hay un package-lock.json suelto en
  // /home/kyk y Next infería esa carpeta como raíz — con la raíz equivocada la
  // externalización de paquetes no resuelve node_modules y los vuelve a
  // empaquetar (además del warning de "multiple lockfiles").
  outputFileTracingRoot: path.join(__dirname),
  // pdf-parse (pdfjs) trae un worker (pdf.worker.mjs) que el bundler NO emite
  // dentro de .next/server/chunks — empaquetado truena en producción con
  // "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs".
  // Externalizados, Node los carga de node_modules en runtime, donde el worker
  // sí existe. mammoth va igual por prevención (misma clase de librería).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth"],
};

export default nextConfig;
