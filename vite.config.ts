import { defineConfig } from "vite";

export default defineConfig({
  // relative asset paths so the same build works served by the helper or packed into an .ehpk
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  // `npm run dev`: the phone loads the app from Vite (hot reload) and the deck WebSocket is
  // proxied to the helper
  server: {
    proxy: { "/ws": { target: "http://localhost:4545", ws: true } },
  },
});
