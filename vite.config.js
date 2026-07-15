import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    minify: "esbuild",
    target: "es2022",
    rollupOptions: {
      output: {
        // merge everything into one file so passcode isn't in a separate chunk
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    __ADMIN_PASSCODE__: JSON.stringify(process.env.ADMIN_PASSCODE || "changeme"),
  },
});
