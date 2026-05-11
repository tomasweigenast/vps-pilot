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
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          // Suppress EPIPE errors from closed WS connections — these are noise
          proxy.on("error", (err, _req, res) => {
            if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
            if ("writeHead" in res) {
              (res as import("http").ServerResponse).writeHead(502);
              res.end("Proxy error");
            }
          });
        },
      },
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
