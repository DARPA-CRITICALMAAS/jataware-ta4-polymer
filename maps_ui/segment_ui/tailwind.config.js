import daisyui from "daisyui";
import { light as lightTheme, dracula as darkTheme } from "daisyui/src/theming/themes";

module.exports = {
  content: ["./src/**/*.{html,js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        light: {
          ...lightTheme,
          "primary": "#439093",
          "secondary": "rgb(200,167,140)",
          "accent": "#05577F",
          "primary-content": "white",
        },
      },
      {
        dark: {
          ...darkTheme,
          "primary": "#33eb91",
          "secondary": "#58FFA9",
          "accent": "#D2FADF",
          "primary-content": "black",
        },
      },
    ],
  },
};
