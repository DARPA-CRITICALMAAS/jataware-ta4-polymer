import "web-streams-polyfill/polyfill";
import { toBeDeepCloseTo,toMatchCloseTo } from 'jest-matcher-deep-close-to';
expect.extend({toBeDeepCloseTo, toMatchCloseTo});

import { parseShapeCoordinates } from "../src/shapefile_parser";

const cdrDefaultProjection = "EPSG:4326";

import polygonShapesPrj from "./data/polygon_shape_prj";
import multiPolygonShapesPrj from "./data/multiPolygon_shape_prj";
import mixedShapesPrj from "./data/mixed_shape_prj";


describe("parseShapeCoordinates", () => {

  test("converts Polygon data", () => {
    // Two Polygon shapes (simulating 2 polygon .shp files in a zip shapefile)
    // The coordinates don't enclose a full polygon, as we're only comparing coordinate
    // formating/transformations
    const actual = parseShapeCoordinates(polygonShapesPrj, cdrDefaultProjection);
    expect(actual)
      .toMatchCloseTo([
        [
          [
            [
              -113.56023517127373,
              36.26136075282121,
            ],
            [
              -113.49848504392759,
              36.26664866459072,
            ],
            [
              -113.43756257792286,
              36.27650792209479,
            ],
          ],
        ],
        [
          [
            [
              -109.1546822419165,
              33.61620256727173,
            ],
            [
              -109.1495060136354,
              33.59914494713759,
            ],
            [
              -109.14479502126035,
              33.588127188395504,
            ],
          ],
        ],
      ]);

  });

  test("handles MultiPolygon data", () => {

    const actual = parseShapeCoordinates(multiPolygonShapesPrj, cdrDefaultProjection);
    expect(actual)
      .toMatchCloseTo([
        [
          [
            [
              2.291863239086439,
              48.8577137262115,
            ],
            [
              2.293452085617105,
              48.856693553273885,
            ],
            [
              2.2968403487010107,
              48.85892279314069,
            ],
          ],
        ],
        [
          [
            [
              2.288226120523035,
              48.86156752523257,
            ],
            [
              2.2899681088877344,
              48.86042149181674,
            ],
            [
              2.290810388976098,
              48.86063558796482,
            ],
          ],
        ],
        [
          [
            [
              2.2912927602678224,
              48.85709062155263,
            ],
            [
              2.2905402133688426,
              48.85661663833349,
            ],
          ],
        ],
      ]);
  });

  test("handles other (Line) data", () => {

    const input = [
      [
        [
          {
            "type": "Feature",
            "properties": {
            },
            "geometry": {
              "type": "LineString",
              "coordinates": [
                [
                  [
                    -1554528.8848,
                    5254.913300000131
                  ],
                  [
                    -1549016.0135999992,
                    4828.82880000025
                  ],
                  [
                    -1543482.2633999996,
                    4923.256599999964
                  ]
                ]
              ]
            }
          }
        ],
        "PROJCS[\"USA_Contiguous_Albers_Equal_Area_Conic\",GEOGCS[\"GCS_North_American_1983\",DATUM[\"D_North_American_1983\",SPHEROID[\"GRS_1980\",6378137.0,298.257222101]],PRIMEM[\"Greenwich\",0.0],UNIT[\"Degree\",0.0174532925199433]],PROJECTION[\"Albers\"],PARAMETER[\"False_Easting\",0.0],PARAMETER[\"False_Northing\",0.0],PARAMETER[\"Central_Meridian\",-96.0],PARAMETER[\"Standard_Parallel_1\",29.5],PARAMETER[\"Standard_Parallel_2\",45.5],PARAMETER[\"Latitude_Of_Origin\",37.5],UNIT[\"Meter\",1.0]]"
      ]
    ];

    const actual = parseShapeCoordinates(input, cdrDefaultProjection);
    expect(actual).toEqual([]);
  });

  test("Handles mixed shape data (line, polygon, multipolygon) from various .shp files in zip", () => {

    const actual = parseShapeCoordinates(mixedShapesPrj, cdrDefaultProjection);
    expect(actual)
      .toMatchCloseTo([
        // From 1st Polygon
        [
          [
            [
              -113.56023517127373,
              36.26136075282121,
            ],
            [
              -113.49848504392759,
              36.26664866459072,
            ],
            [
              -113.43756257792286,
              36.27650792209479,
            ],
          ],
        ],
        // From 1st entry in MultiPolygon
        [
          [
            [
              -95.99997382835481,
              37.50043595717267,
            ],
            [
              -95.99997381021119,
              37.500435948069665,
            ],
            [
              -95.99997377151932,
              37.50043596796116,
            ],
          ],
        ],
        // From 2nd entry in MultiPolygon
        [
          [
            [
              -95.99997386988841,
              37.500435991560124,
            ],
            [
              -95.999973849996,
              37.50043598133407,
            ],
            [
              -95.99997384037769,
              37.50043598324442,
            ],
          ],
        ]
        // No LineString data coordinates, as those are ignored
      ]);

  })

});
