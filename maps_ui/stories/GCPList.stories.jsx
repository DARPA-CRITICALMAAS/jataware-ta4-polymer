import GCPList from "../components/GCPList.tsx";
import { fn } from "@storybook/test";
import clip from "./assets/clip-tiff.png";

export default {
  title: "Common/GCPList",
  component: GCPList,
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
          height: "220rem",
          width: "90%",
          display: "flex",
          flexDirection: "column",
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

// hardcoded clip from import
const ClipComponent = () => {
  return (
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
  );
};

export const Base = {
  args: {
    height: 14940,
    GCPOps: {
      updateGCP: fn(),
      deleteGCP: fn(),
    },
    gcps: [
      {
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
        reference_id: "",
        provenance: "polymer_0.0.1",
        height: 14940,
        color: [221, 171, 34],
        x_dms: "-148° 0' 0\"",
        y_dms: "60° 0' 0\"",
        just_edited: false,
      },
      {
        gcp_id: "f3645299-f675-4715-909f-98fdc67ff453",
        cog_id:
          "5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9",
        modified: "2024-06-03T11:23:42.090773",
        created: "2024-06-03T11:23:42.090774",
        system: "polymer",
        system_version: "0.0.1",
        registration_id: "",
        model_id: "",
        model: "",
        model_version: "",
        rows_from_top: 738,
        columns_from_left: 11229,
        latitude: 63.3661111111,
        longitude: -146.5,
        crs: "EPSG:4326",
        reference_id: "",
        provenance: "polymer_0.0.1",
        height: 14940,
        color: [246, 66, 111],
        x_dms: "-146° 30' 0\"",
        y_dms: "63° 21' 58\"",
        just_edited: false,
      },
    ],
    ClipComponent,
    cog_id: "5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9",
  },
};

export const readonly = {
  args: {
    ...Base.args,
    readonly: true,
  },
};
