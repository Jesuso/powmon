import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: client on 5173, API proxied to fastify on 3001.
// Prod: `npm run build` -> dist/, served by fastify.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true, ws: true },
    },
  },
});
