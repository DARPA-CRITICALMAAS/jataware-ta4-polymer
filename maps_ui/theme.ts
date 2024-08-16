import { experimental_extendTheme as extendTheme } from "@mui/material/styles";
import { purple, amber, indigo, green, lime } from "@mui/material/colors";

export const theme = extendTheme({
  colorSchemes: {
    // DARK !!
    dark: {
      palette: {
        common: {
          background: "#282936",
          // "#1d1e27"
        },
        success: { main: green["A400"] },
        warning: { main: amber[500] },

        primary: {
          main: "#b19df7",
          // #b19df7 // highlight text color
        },

        secondary: { main: purple.A100 },

        background: {
          default: "#282936",
          paper: "#1d1e27",
          highlight: "rgba(177, 157, 247, 0.16)",
          border: "rgba(177, 157, 247, 0.16)",
        },
        text: {
          main: "#e5e7eb",
        },
      },
    },
    // LIGHT !!!!!
    light: {
      palette: {
        success: { main: green["A700"] },
        common: {
          background: "#f5f5f5",
        },
        background: {
          paper: "#f2f0f0",
          highlight: "#b9bbd0b8",
        },

        secondary: { main: indigo.A400 }, // blueGrey[600],
      },
    },
  },
});
