import { defineConfig } from "vite";
import tailwindcss from "tailwindcss";

const servingOptions = {
  open: true,
  port: 8080,
  proxy: {
    "/api": {
      target: "http://0.0.0.0:3000",
      secure: false,
      rewrite: (path) => path.replace(/^\/api/, ""),
    },
  },
};

/** https://vitejs.dev/config/ */
export default defineConfig({
  root: "src",
  base: "",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: servingOptions,
  preview: servingOptions,
  css: {
    cssCodeSplit: false,
    postcss: {
      plugins: [tailwindcss],
    },
  },
  esbuild: {
    jsxInject: `import React from 'react'`,
    target: "es2020",
    supported: {
      "top-level-await": true,
    },
  },
});
