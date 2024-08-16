/** @type { import('@storybook/react').Preview } */

import CssBaseline from "@mui/material/CssBaseline";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Experimental_CssVarsProvider as CssVarsProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router";

import "../app.css";
import { theme } from "../theme.ts";

const queryClient = new QueryClient();

export const parameters = {
  mockAddonConfigs: {
    // globalMockData: [{
    //   // An array of mock objects which will add in every story
    //   url: 'http://localhost:0000',
    //   method: 'PUT',
    //   status: 201,
    //   response: {},
    // }],
    ignoreQueryParams: true, // Whether or not to ignore query parameters globally
    refreshStoryOnUpdate: true,
    // This property re-renders the story if there's any data changes
    disableUsingOriginal: false, // This property disables the toggle (on/off) option to use the original endpoint
    // disable: true, // This property disables the panel from all the stories
  },
};

const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },

  // staticDirs: ["../public"],

  decorators: [
    (Story) => (
      <div>
        <QueryClientProvider client={queryClient}>
          <CssVarsProvider theme={theme}>
            <CssBaseline />
            <MemoryRouter initialEntries={["/"]}>
              <Story />
            </MemoryRouter>
          </CssVarsProvider>
        </QueryClientProvider>
      </div>
    ),
  ],
};

export default preview;
