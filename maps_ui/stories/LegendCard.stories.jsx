import LegendCard from "../components/LegendCard.tsx";
import { fn } from "@storybook/test";
// import clip from "./assets/clip-tiff.png";

export default {
  title: "Swatch Annotation/LegendCard",
  component: LegendCard,
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
          width: "30rem",
          height: "80%",
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
    mockBaseUrl: "http://localhost:3000",
    // cog_id: "5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9",
    item:
    {
      "cog_id": "5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9",
      "legend_id": "5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9_polymer_0.0.1_27bea14efa5fc873c7a9d023a6d2184e11c2182d57178398782c7df4356ed656_MAFICMETAVOLCANICROCKSgrayandred-brownbasalticagglomandgabbroicrocks.Volcanicrocks;siliceous,argillaceouslimestone.Mcontrolforthisunitisfrominterla:MiddleDevonianage(Clauticeanunit,includingtheinterlayeredoverlying(?)metavolcaniclasticrocsimilartothatofthePennsylvani:(unitPmv).",
      "descriptions": [],
      "image_url": "/api/map/clip-bbox?cog_id=5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9&minx=13376&miny=4986&maxx=13558&maxy=5084",
      "extent_from_bottom": [
        13376.307343243165,
        4986.042975375102,
        13558.866617728148,
        5084.781621995826
      ],
      "coordinates_from_bottom": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              13376.307343243165,
              4986.042975375102
            ],
            [
              13558.866617728148,
              4986.042975375102
            ],
            [
              13558.866617728148,
              5084.781621995826
            ],
            [
              13376.307343243165,
              5084.781621995826
            ],
            [
              13376.307343243165,
              4986.042975375102
            ]
          ]
        ]
      },
      "label_coordinates_from_bottom": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              13574.962738434582,
              4431.125458721178
            ],
            [
              14410.263606076514,
              4431.125458721178
            ],
            [
              14410.263606076514,
              5103.772975585155
            ],
            [
              13574.962738434582,
              5103.772975585155
            ],
            [
              13574.962738434582,
              4431.125458721178
            ]
          ]
        ]
      },
      "abbreviation": "PIPP>cmv ",
      "label": "MAFIC METAVOLCANIC ROCKS gray and red-brown basaltic agglom and gabbroic rocks. Volcanic rocks ; siliceous, argillaceous limestone. M control for this unit is from interla: Middle Devonian age (Clautice an unit, including the interlayered overlying(?) metavolcaniclastic roc similar to that of the Pennsylvani: (unit Pmv). ",
      "model": null,
      "model_version": null,
      "system": "polymer",
      "system_version": "0.0.1",
      "provenance": "polymer_0.0.1",
      "category": "polygon",
      "confidence": null,
      "status": "created",
      "notes": "",
      "color": "",
      "pattern": "",
      "minimized": true,
      "age_text": "",
      "coordinates": {
        "type": "Polygon",
        "coordinates": [
          [
            [
              13376.307343243165,
              9953.957024624899
            ],
            [
              13558.866617728148,
              9953.957024624899
            ],
            [
              13558.866617728148,
              9855.218378004174
            ],
            [
              13376.307343243165,
              9855.218378004174
            ],
            [
              13376.307343243165,
              9953.957024624899
            ]
          ]
        ]
      },
      "reference_id": "5a06544690b6611f419f0c6f244776a536ad52915555555555515545c9b1ddb9rgba(13376,4986,13559,5084.78)PIPP>cmv "
    },
    updateItem: identity,
    saveItem: identity,
    removeItem: identity,
    zoomTo: identity,
    ocrLastClipArea: identity,
    geologicAges: [],
  },
};

// export const readonly = {
//   args: {
//     ...Base.args,
//     readonly: true,
//   },
// };
