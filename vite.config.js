import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    minify: "esbuild",
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
