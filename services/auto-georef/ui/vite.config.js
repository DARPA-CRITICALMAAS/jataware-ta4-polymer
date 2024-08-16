import inject from "@rollup/plugin-inject";
import { defineConfig } from "vite";
import { glob } from "glob";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  build: {
    // minify: false, // TODO for now
    emptyOutDir: true,
    outDir: "../static/js/",
    lib: {
      entry: glob.sync("src/**/*.ts"),
      formats: ["es"],
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@fortawesome/fontawesome-free/webfonts/",
          dest: "..",
        },
      ],
    }),
    inject({ htmx: "htmx.org" }),
  ],
});
