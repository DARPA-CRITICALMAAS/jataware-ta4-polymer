import ButtonInput from "../components/ButtonInput.tsx";
import { fn } from "@storybook/test";
// import clip from "./assets/clip-tiff.png";
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';

export default {
  title: "Swatch Annotation/ButtonInput",
  component: ButtonInput,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  // tags: ["autodocs"],
  parameters: {
    // More on how to position stories at: https://storybook.js.org/docs/configure/story-layout
    layout: "fullscreen",
  },

  decorators: [
    (Story) => (
      <div
        style={{
          margin: "1rem",
          width: "75%",
          height: "75%",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    // forceLoading: fn(),
  },
};

const identity = (...args) => args[0];

export const Base = {
  args: {
    icon: <HighlightAltIcon />,
    label: "Label"
  }
};
