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
  server: {
    port: 5173,
    proxy: {
      // WebSocket proxy — separate entry so ws:true doesn't affect HTTP
      "/api/ws": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
      // HTTP API proxy
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      // File downloads
      "/files/download": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../internal/webapp/dist",
    emptyOutDir: true,
  },
});
