/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "media",
  content: [
    "../silk/templates/*.html",
    "../silk/templates/**/*.html",
  ],
  theme: {
    extend: {
    },
  },
  safelist: [
    "text-red-500",
    {
      pattern: /bg-+/,
    },
    {
      pattern: /(m|w|h|p)(t|r|b|l)?-+/,
    },
    {
      pattern: /progres+/,
    },
    {
      pattern: /toolti+/,
    },
  ],
  plugins: [
    require("daisyui")
  ],
  daisyui: {
    themes: [
      "light",
      "dark",
      "business",
      "night",
      {
        custom: {
          /*
            https://www.happyhues.co/palettes/4
            https://daisyui.com/docs/colors/

            "primary": "#683BED",
            "base-100": "#16161a",
          */
          "primary": "#2b56f0",
          "primary-content": "#fffffe",
          "secondary": "#72757e",
          "secondary-content": "#fffffe",
          "accent": "#2cb67d",
          "neutral": "#242629",
          "neutral-content": "#fffffe",
          "base-100": "#1B1B1E",
          "base-content": "#fffffe",
          "info": "#0ca6e9",
          "success": "#2bd4bd",
          "warning": "#f4c152",
          "error": "#fb6f84",
        }
      },
    ],
  },
}

