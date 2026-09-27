import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
  preview: {
    port: 8080,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("pdfjs-dist")) return "pdf";
            if (id.includes("react") || id.includes("react-dom")) return "react-vendor";
            if (id.includes("@tanstack/react-query")) return "query-vendor";
            if (id.includes("lucide-react")) return "icons";
            return "vendor";
          }
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});
