import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchAPI } from "./utils";
import type { MultiPolygon } from "geojson";
import type { Layer, LegendItem } from "./Types";
import type { LayerStore } from "../app";
import type { AlertStore } from "./Alert";
import * as E from "./Elements";

declare global {
  interface JSON {
    parse<T>(text: string): T;
  }
}

async function* streamIterator(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("Response body is undefined");

  const reader = response.body.getReader();
  let buffer = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done || value == null) return;

    const chunk = new TextDecoder().decode(value);
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      yield line;
    }
  }
}

const Options = ({
  LayerStore,
  AlertStore,
  cog_id,
}: {
  LayerStore: LayerStore;
  AlertStore: AlertStore;
  cog_id: string;
}) => {
  const layers = useSyncExternalStore(LayerStore.subscribe, LayerStore.getSnapshot);

  // Import polygons state
  const [isLoading, setIsLoading] = useState<Map<string, boolean>>(new Map());
  const [hasImported, setHasImported] = useState<Map<string, boolean>>(new Map());

  const handleImport = (system: string, version: string) => async () => {
    const sysver = `${system}__${version}`;
    setIsLoading(new Map(isLoading.set(sysver, true)));
    await importPolygons(system, version);
    setIsLoading(new Map(isLoading.set(sysver, false)));
    setHasImported(new Map(hasImported.set(sysver, true)));
  };

  const [systems, setSystems] = useState<Map<string, string[]> | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const response = await fetchAPI<Record<string, string[]>>("systems", {
          method: "GET",
          query: { cog_id },
        });
        if (!response.ok) throw new Error("Error fetching systems from the server.");

        const systems = await response.json();
        setSystems(new Map(Object.entries(systems)));
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    })();
  }, []);

  const uploadErrorAlert = AlertStore.create({
    message: "Could not upload to CDR.",
    type: "error",
    time: 5000,
  });

  const uploadSuccessAlert = AlertStore.create({
    message: "Finished uploading to CDR.",
    type: "success",
    time: 5000,
  });

  const importPolygons = async (system: string, version: string) => {
    const loadingAlert = AlertStore.create({
      message: `Importing polygons for ${system} ${version}...`,
      type: "info",
    });

    try {
      AlertStore.show(loadingAlert);

      const response = await fetchAPI("import_polygons", {
        method: "GET",
        query: { cog_id, system, version },
      });

      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      // Checks if the legend item is unique
      const isUnique = (legendItem?: LegendItem) => {
        const allLegendIDs = Array.from(
          LayerStore.layers.values(),
          (layer) => layer.legendItem?.id,
        ).filter(Boolean);
        return allLegendIDs.every((id) => legendItem?.id !== id);
      };

      for await (const line of streamIterator(response)) {
        const { name, polygon, legend_item, color, is_validated } = JSON.parse<{
          name: string;
          polygon: MultiPolygon;
          legend_item?: LegendItem;
          color?: [number, number, number];
          is_validated?: boolean;
        }>(line);

        const layer = {
          id: LayerStore.getNewID(),
          name,
          polygon,
          legendItem: isUnique(legend_item) ? legend_item : undefined,
          color,
          isValidated: isUnique(legend_item) && is_validated ? true : undefined,
        };
        console.info(layer);
        LayerStore.setLayer(layer, true);
      }

      AlertStore.close(loadingAlert.id);
      AlertStore.show(
        AlertStore.create({
          message: `Finished importing polygons for ${system} ${version}.`,
          type: "success",
          time: 5000,
        }),
      );
    } catch (error) {
      AlertStore.close(loadingAlert.id);
      AlertStore.show(
        AlertStore.create({
          message: "Error retrieving polygons from the server. Please try again later.",
          type: "error",
          showAlertType: false,
          time: 5000,
        }),
      );
      console.error("Error fetching data:", error);
    }
  };

  const uploadToCDR = async () => {
    E.options.close();

    LayerStore.updateCurrentLayer();

    const validatedLayers = Array.from(layers.values()).filter(
      (layer) => layer.isValidated && layer.legendItem,
    ) as (Layer & { legendItem: LegendItem })[];

    const response = await fetchAPI("upload_layers", {
      method: "POST",
      body: {
        cog_id,
        layers: validatedLayers.map((layer) => ({
          polygon: layer.polygon,
          legend_id: layer.legendItem.id,
        })),
      },
    });

    if (!response.ok) {
      console.error("Error uploading layers:", response.statusText);
      AlertStore.show(uploadErrorAlert);
      return;
    }

    AlertStore.show(uploadSuccessAlert);
  };

  const createEmbeds = async () => {
    E.options.close();

    const response = await fetchAPI<{ time: number }>("embeddings_to_s3", {
      method: "POST",
      query: { cog_id },
    });

    if (!response.ok) {
      console.error("Error creating image embeddings:", response.statusText);
    }

    const { time } = await response.json();

    const roundInterval = 5;
    const roundedTime =
      time < roundInterval
        ? Math.max(1, Math.ceil(time))
        : Math.ceil(time / roundInterval) * roundInterval;

    const timeUnit = roundedTime === 1 ? "minute" : "minutes";

    AlertStore.show(
      AlertStore.create({
        message: `Creating image embeddings... Check back in about ${roundedTime} ${timeUnit}.`,
        type: "info",
        time: 10_000,
      }),
    );
  };

  const checkEmbeds = async () => {
    E.options.close();

    const response = await fetchAPI("load_segment", {
      method: "POST",
      query: { cog_id },
    });

    if (!response.ok) {
      AlertStore.show(
        AlertStore.create({
          message: "Image embeddings are not yet available.",
          type: "error",
          time: 5000,
        }),
      );
    } else {
      AlertStore.show(
        AlertStore.create({
          message: "Image embeddings are available.",
          type: "success",
          time: 5000,
        }),
      );
    }
  };

  const reloadTools = async () => {
    E.options.close();

    const lassoResponse = await fetchAPI("load_lasso", { method: "POST", query: { cog_id } });
    const labelResponse = await fetchAPI("load_segment", { method: "POST", query: { cog_id } });

    if (!lassoResponse.ok) {
      AlertStore.show(
        AlertStore.create({
          message: "Error loading lasso tool.",
          type: "error",
          showAlertType: false,
          time: 5000,
        }),
      );
    }

    if (!labelResponse.ok) {
      AlertStore.show(
        AlertStore.create({
          message: "Error loading label tool.",
          type: "error",
          showAlertType: false,
          time: 5000,
        }),
      );
    }

    if (lassoResponse.ok && labelResponse.ok) {
      AlertStore.show(
        AlertStore.create({
          message: "Reloaded all segmentation tooling.",
          type: "success",
          time: 5000,
        }),
      );
    }
  };

  const System = ({ system, versions }: { system: string; versions: string[] }) => (
    <li>
      <details open>
        <summary>
          <i className="fa-solid fa-user-gear"></i>
          <span>{system}</span>
        </summary>
        <ul>
          {versions.map((version) => (
            <li
              key={version}
              className={
                (hasImported.get(`${system}__${version}`) ?? false) ? "btn-disabled disabled" : ""
              }
            >
              <button
                onClick={handleImport(system, version)}
                className="my-1"
                disabled={hasImported.get(`${system}__${version}`) ?? false}
              >
                {isLoading.get(`${system}__${version}`) ? (
                  <i className="loading loading-spinner loading-sm"></i>
                ) : (
                  <i className="fa-solid fa-gears"></i>
                )}
                <span>{version}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );

  return (
    <>
      <div className="modal-box z-20 flex flex-col overflow-clip bg-base-200">
        <form method="dialog">
          <button className="btn btn-circle btn-ghost btn-sm absolute right-2 top-2">✕</button>
        </form>

        <h2 className="mb-4 mt-3 text-2xl font-bold">More Options</h2>

        <div className="-m-6 mt-2 flex flex-col gap-2 overflow-y-hidden bg-base-100 p-2 pt-0 before:content-['_']">
          <div className="flex flex-col gap-2 overflow-y-auto p-8 pt-2">
            <div className="divider">
              <div className="flex items-center gap-2 align-middle">
                <i className="fa-solid fa-cloud-arrow-down"></i>
                <h3 className="text-xl font-bold">Import Polygons</h3>
              </div>
            </div>

            <ul tabIndex={0} className="menu p-0">
              {systems === null ? (
                <li>
                  <div>
                    <i className="loading loading-spinner loading-sm"></i>
                    <span>Loading systems</span>
                  </div>
                </li>
              ) : systems.size === 0 ? (
                <li>
                  <div>
                    <i className="fa-solid fa-ban"></i>
                    <span>No systems found</span>
                  </div>
                </li>
              ) : (
                Array.from(systems.entries()).map(([system, versions]) => (
                  <System key={system} system={system} versions={versions} />
                ))
              )}
            </ul>

            <div className="divider bg-transparent">
              <h3 className="text-xl font-bold">Other</h3>
            </div>

            <button className="btn btn-ghost" onClick={uploadToCDR}>
              <i className="fa-solid fa-cloud-arrow-up"></i>
              <span>Upload All Validated Layers to CDR</span>
            </button>

            <button disabled className="btn btn-ghost" onClick={createEmbeds}>
              <i className="fa-solid fa-circle-nodes"></i>
              <span>Create Image Embeddings for Label Tool</span>
            </button>

            <button className="btn btn-ghost" onClick={checkEmbeds}>
              <i className="fa-solid fa-flag"></i>
              <span>Check Whether Image Embeddings Exist</span>
            </button>

            <button className="btn btn-ghost" onClick={reloadTools}>
              <i className="fa-solid fa-rotate"></i>
              <span>Reload Segmentation Tooling</span>
            </button>
          </div>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop h-screen w-screen">
        <button>Close</button>
      </form>
    </>
  );
};

export default Options;
