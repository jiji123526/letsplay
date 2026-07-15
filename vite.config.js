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
  define: {
    __ADMIN_PASSCODE__: JSON.stringify(process.env.ADMIN_PASSCODE || "changeme"),
  },
});
