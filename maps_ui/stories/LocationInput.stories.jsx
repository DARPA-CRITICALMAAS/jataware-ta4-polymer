import LocationInput from "../components/LocationInput.tsx";
import { fn } from "@storybook/test";

export default {
  title: "LocationInput",
  component: LocationInput,
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
          margin: "auto",
          width: "40rem",
          height: "40rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Story />
      </div>
    ),
  ],
  // args: {
  //   onLogin: fn(),
  //   onLogout: fn(),
  //   onCreateAccount: fn(),
  // },
};

export const X_DMS = {
  args: {
    input_label: "x_dms",
    gcp: {
      gcp_id: "manual_b903f52c-694c-4269-8cf0-5a6e7720fcd6",
      rows_from_top: 4512,
      columns_from_left: 13400,
      longitude: null,
      latitude: null,
      x_dms: null,
      y_dms: null,
      crs: "",
      provenance: "polymer_0.0.1",
      system: "polymer",
      system_verison: "0.0.1",
      model: null,
      model_version: null,
      reference_id: null,
      color: [236, 97, 215],
      height: 14940,
    },
    updateDMS: fn(),
    // user: {
    //   name: "Jane Doe",
    // },
  },
};
