import { defineConfig } from "vite";

export default defineConfig({
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
