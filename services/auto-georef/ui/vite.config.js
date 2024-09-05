import inject from "@rollup/plugin-inject";
import { defineConfig } from "vite";
import { glob } from "glob";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import fs from "fs";
import JSON5 from "json5";

const sourceDir = "src";

const tsconfigPaths = () => {
  const tsconfig = fs.readFileSync(path.resolve(__dirname, "tsconfig.json"));
  const { paths } = JSON5.parse(tsconfig).compilerOptions;
  if (!paths) return {};

  const aliases = {};
  for (const [key, value] of Object.entries(paths)) {
    // TODO: Make generic to handles all path mappings, converting tsconfig globs to rollup regex
    const keyWithoutStar = key.replace("/*", "");
    const valueWithoutStar = value[0].replace("/*", "");
    aliases[keyWithoutStar] = path.resolve(__dirname, valueWithoutStar);
  }
  return aliases;
};

export default defineConfig((configEnv) => {
  const isDev = configEnv.mode === "development";

  return {
    build: {
      emptyOutDir: true,
      outDir: "../static/js/",
      lib: {
        entry: glob.sync(path.join(sourceDir, "**/!(*.d).ts")),
        formats: ["es"],
      },
      rollupOptions: {
        output: {
          chunkFileNames: "chunks/[name]-[hash].js",
          entryFileNames: ({ facadeModuleId }) => {
            const defaultFileName = "[name].js";

            // Calculate the relative path from the source directory to the main entry point
            const sourcePath = path.join(path.dirname(__filename), sourceDir);
            const relativeEntryPoint = path.relative(
              sourcePath,
              facadeModuleId,
            );
            const relativeDir = path.dirname(relativeEntryPoint);

            // Return the relative path with the default file name.
            // This allows for deeply nested output directories
            return path.join(relativeDir, defaultFileName);
          },
        },
      },
      sourcemap: isDev,
    },
    resolve: {
      alias: {
        ...tsconfigPaths(),
      },
    },
    plugins: [
      viteStaticCopy({
        targets: [
          {
            src: "node_modules/@fortawesome/fontawesome-free/webfonts/",
            dest: "..", // relative to outDir
          },
        ],
      }),
      inject({ htmx: "htmx.org" }),
    ],
  };
});
