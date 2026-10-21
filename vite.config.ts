import { defineConfig } from "vite";

export default defineConfig({
  // relative asset paths so the same build works served by the helper or packed into an .ehpk
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
