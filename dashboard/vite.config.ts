import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Builds to dashboard/dist, which the hub serves as static assets.
// During `vite dev`, /api is proxied to the running hub so SSE + REST work locally.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://localhost:4100", changeOrigin: true },
    },
  },
});
