/* TWO Shapes
Each one a Polygon
coordinates don't actually enclose a full polygon, as I reduced the file coordinates
But these examples should be enough to perform transformations we need
*/

export default [
  [
    [
      {
        "type": "Feature",
        "properties": {
          "OBJECTID_1": 1,
          "PERIMETER": 2882760,
          "REGION": "SB",
          "AREA_SQKM": 245059,
          "Shape_Leng": 2646213.04929,
          "Shape_Area": 245058854055,
          "NAME": "Southern Basin and Range"
        },
        "geometry": {
          "type": "Polygon",
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
  ],
  [
    [
      {
        "type": "Feature",
        "properties": {
          "OBJECTID": 1,
          "AREA": 301065000000,
          "PERIMETER": 2882760,
          "REGIONS_": 105,
          "REGIONS_ID": 12,
          "REGION": "SB",
          "NAME": "SB",
          "WORDS": "Southern Basin and Range",
          "AREA_SQKM": 301065,
          "Shape_Leng": 2885612.96754,
          "Shape_Le_1": 3069284.96002,
          "Shape_Area": 309163806907
        },
        "geometry": {
          "type": "Polygon",
          "coordinates": [
            [
              [
                -1208272.1278000008,
                -350932.09049999993
              ],
              [
                -1208062.5210999995,
                -352885.0206000004
              ],
              [
                -1207802.1607000008,
                -354163.80590000004
              ]
            ]
          ]
        }
      }
    ],
    "PROJCS[\"USA_Contiguous_Albers_Equal_Area_Conic\",GEOGCS[\"GCS_North_American_1983\",DATUM[\"D_North_American_1983\",SPHEROID[\"GRS_1980\",6378137.0,298.257222101]],PRIMEM[\"Greenwich\",0.0],UNIT[\"Degree\",0.0174532925199433]],PROJECTION[\"Albers\"],PARAMETER[\"False_Easting\",0.0],PARAMETER[\"False_Northing\",0.0],PARAMETER[\"Central_Meridian\",-96.0],PARAMETER[\"Standard_Parallel_1\",29.5],PARAMETER[\"Standard_Parallel_2\",45.5],PARAMETER[\"Latitude_Of_Origin\",37.5],UNIT[\"Meter\",1.0]]"
  ]
]
