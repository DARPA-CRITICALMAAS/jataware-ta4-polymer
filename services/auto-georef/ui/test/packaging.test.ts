import { createPackagingData } from "../src/features/packaging";

describe("createPackagingData", () => {

  test("given 1 layerUrl for cog_ids, returns a dictionary with selected feature properties", () => {

    const input = "http://localhost:8333/v1/tiles/tile/{z}/{x}/{y}?search_terms=sink&feature_type=point&cog_ids=48e472e466e504e50cd54eb561b5c4b516b53bb53db51cb5d8b471b557844f0a";

    const out = createPackagingData(input)
      expect(out).toEqual({
          search_terms: ["sink"],
          category: "point",
          cog_ids: ["48e472e466e504e50cd54eb561b5c4b516b53bb53db51cb5d8b471b557844f0a"]
      });
  });

  test("given 1 layerUrl for cma_id, returns a dictionary with selected feature properties", () => {

    const input = "http://localhost:8333/v1/tiles/tile/{z}/{x}/{y}?search_terms=div&search_terms=another&feature_type=line&cma_id=my_cma_id";

    const out = createPackagingData(input)
      expect(out).toEqual({
          search_terms: ["div", "another"],
          category: "line",
          cma_id: "my_cma_id"
      });
  });

});
