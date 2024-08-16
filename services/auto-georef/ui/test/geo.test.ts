import proj4 from "proj4";

import { toBeDeepCloseTo,toMatchCloseTo } from 'jest-matcher-deep-close-to';
expect.extend({toBeDeepCloseTo, toMatchCloseTo});

import { transformPolygonCoordinates, openLayersDefaultProjection, cdrDefaultProjection } from "../src/geo";

describe("transformPolygonCoordinates", () => {

  test("Transform pair of coordinates example: from arbitrary to Openlayers projection", () => {

    const sourceBase = 'PROJCS["USA_Contiguous_Albers_Equal_Area_Conic",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-96.0],PARAMETER["Standard_Parallel_1",29.5],PARAMETER["Standard_Parallel_2",45.5],PARAMETER["Latitude_Of_Origin",37.5],UNIT["Meter",1.0]]';

    const source = proj4(sourceBase);
    const dest = openLayersDefaultProjection;
    const actual = transformPolygonCoordinates([[[-1554528.8848, 5254.913300000131]]], source, dest)[0];

    // Converting toFixed (string) for tests to pass more consistently (float representation etc)
    expect(actual).toMatchCloseTo([[-12641467.55363058, 4336644.059837425]]);
  });

});
