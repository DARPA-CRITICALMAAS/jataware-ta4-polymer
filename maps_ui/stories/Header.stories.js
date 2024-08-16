import Header from "../components/Header";
import { fn } from "@storybook/test";

export default {
  title: "Georeference/Header",
  component: Header,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  // tags: ["autodocs"],
  parameters: {
    // More on how to position stories at: https://storybook.js.org/docs/configure/story-layout
    layout: "fullscreen",
  },
  args: {
    // forceLoading: fn(),
  },
};

export const Base = {
  args: {},
};

export const Loading = {
  args: {
    forceLoading: true,
  },
};

export const WithCog = {
  args: {
    cog_id: "c4f9c335b3459b4d856d14e798adc4a6ccb0c030f4926441ce52c390f1c8d1b9-a"
  },
};
