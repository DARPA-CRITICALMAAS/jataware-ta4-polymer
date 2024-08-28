/** @type {import('tailwindcss').Config} */
import daisyui from "daisyui";
import tailwindTypography from "@tailwindcss/typography";
import {
  light as lightTheme,
  dracula as darkTheme,
} from "daisyui/src/theming/themes";

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "../auto_georef/templates/**/*.html",
    "../auto_georef/templates/**/*.jinja",
    "../auto_georef/templates/**/*.html.jinja",
    "./src/**/*.ts",
    "./src/**/*.js",
  ],
  plugins: [daisyui, tailwindTypography],
  daisyui: {
    themes: [
      {
        light: {
          ...lightTheme,
          primary: "#439093",
          secondary: "rgb(200,167,140)",
          accent: "#05577F",
          "neutral-content": "oklch(0.8 0 0)",
          "primary-content": "white",
          "info-content": "white",
        },
      },
      {
        dark: {
          ...darkTheme,
          primary: "#33eb91",
          secondary: "#58FFA9",
          accent: "#D2FADF",
          "primary-content": "black",
          "info-content": "black",
        },
      },
    ],
  },
  theme: {
    extend: {
      screens: {
        // Small screens, vertically
        'slim': {'raw': '(max-height: 775px)'},
        // => @media (max-height: 700px) { ... }
      }
    }
  },
  // tailwind might not work well with jinja templates or python code
  // may have to add some of these so that they aren't
  // tree-shaken and removed from final css build..
  safelist: [
    {
      pattern: /text-[a-z]+-[2-6]00/,
    },
    {
      pattern: /border-[a-z]+-[2-6]00/,
    },
    "size-4",
    "bg-slate-400",
    "bg-accent",
    "bg-base-200",
    "badge-outline",
    "size-2", "size-3", "size-4"
  ],
};
