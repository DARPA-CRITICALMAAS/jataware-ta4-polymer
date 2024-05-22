import inject from '@rollup/plugin-inject';
import { defineConfig } from 'vite';
import { resolve } from "path";
import { glob } from 'glob';

export default defineConfig({

  build: {
    target: 'esnext',
    minify: false,
    emptyOutDir: true,
    outDir: "../static/js/",
    lib: {
      entry: glob.sync('src/**/*.js'),
      formats: ['es'],
    },
  },
  plugins: [
    inject({
       htmx: 'htmx.org'
    }),
  ],
});
