import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../internal/webapp/dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true, ws: true },
      "/webhooks": { target: "http://localhost:8080", changeOrigin: true },
      "/files": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
