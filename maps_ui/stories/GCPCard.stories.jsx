import GCPCard from "../components/GCPCard.tsx";
import { fn } from "@storybook/test";
import clip from "./assets/clip-tiff.png";

export default {
  title: "Georeference/GCPCard",
  component: GCPCard,
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
          maxWidth: "50rem",
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

export const Base = {
  args: {
    height: 14940,
    updateGCP: fn(),
    deleteGCP: fn(),
    gcp: {
      gcp_id: "ea1de7d5-b502-45e9-b340-d9af1a00ab27",
      cog_id:
        "5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9",
      modified: "2024-05-30T11:40:08.895971",
      created: "2024-05-30T11:40:08.895972",
      system: "polymer",
      system_version: "0.0.1",
      registration_id: "",
      model_id: "",
      model: "",
      model_version: "",
      rows_from_top: 8995,
      columns_from_left: 469,
      latitude: 60,
      longitude: -148,
      crs: "EPSG:4326",
      confidence: null,
      reference_id: "",
      provenance: "polymer_0.0.1",
      height: 14940,
      color: [127, 58, 240],
      x_dms: "-148° 0' 0\"",
      y_dms: "60° 0' 0\"",
      just_edited: false,
    },
    children: (
      <img
        src={clip}
        style={{
          opacity: "0.8",
          border: "5px solid blue",
          borderRadius: 5,
          height: "100%",
          width: "100%",
        }}
      />
    ),
  },
};

export const readonly = {
  args: {
    ...Base.args,
    readonly: true,
  },
};
