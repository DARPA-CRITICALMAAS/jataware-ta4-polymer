import React, { useState } from "react";

import { returnImageBufferUrl } from "./helpers";

import { MapSpinner } from "../Spinner";

import "../css/small_map.scss";

function SmallMapImage({ cog_id, gcp, height }) {
  const [clipUrl, setClipUrl] = useState(
    returnImageBufferUrl(cog_id, gcp, height),
  );

  const [isLoading, setLoading] = useState(true);

  function returnColor(arr) {
    return `rgb(${arr[0]},${arr[1]},${arr[2]} )`;
  }
  function returnHeight() {
    return "220px";
  }

  function onError() {
    setLoading(false);
  }
  function onLoad() {
    setLoading(false);
  }

  if (!clipUrl) {
    return null;
  }

  return (
    <div
      className="small-map-image-root"
      style={{
        border: `5px solid ${returnColor(gcp.color)}`,
      }}
    >
      {isLoading && (
        <div className="small-map-spinner">
          <MapSpinner />
        </div>
      )}
      <img
        src={clipUrl}
        alt="Loading Clipped Map..."
        onError={onError}
        onLoad={onLoad}
        className={"small-map-image"}
        style={isLoading ? { visibility: "hidden" } : {}}
      />
    </div>
  );
}
export default SmallMapImage;
