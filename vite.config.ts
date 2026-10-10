import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.PORT ?? "8787";

// GitHub Pages serves the app from /<repo>/; the Pages workflow passes --base.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
