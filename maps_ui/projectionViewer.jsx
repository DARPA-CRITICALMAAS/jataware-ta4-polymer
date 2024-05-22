import React, { useState, useEffect } from 'react';
import MapPage from './components/projectionComponents.tsx'
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { dec2dms } from './components/helpers.js'
import { pointerMove } from 'ol/events/condition';

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  'Content-Type': 'application/json',
}
function ProjectionViewer() {
  const { cog_id } = useParams();
  const [georeferenced, _] = useState(false)
  const [mapData, setMapData] = useState(null)


  const getProjectionNames = async (mapper) => {
    try {
      const validRequests = Object.keys(mapper).map(code => {
        let code_ = parseInt(code.split("EPSG:")[1]);
        if (isNaN(code_)) return null; // Return null for invalid codes
        return axios.get(`/api/map/get_projection_name/${code_}`, { headers: _APP_JSON_HEADER })
          .catch(error => console.error(`Error fetching data for code ${code_}:`, error));
      }).filter(request => request !== null);

      const responses = await Promise.all(validRequests);
      responses.forEach(response => {
        const epsgCode = "EPSG:" + response.config.url.split('/').pop();
        const projectionName = response.data.projection_name;
        mapper[epsgCode] = projectionName;
      });
      return mapper

    } catch (error) {
      console.error('Error fetching projection names:', error);
    }
  };
  useEffect(() => {
    fetchData(cog_id)
  }, [cog_id]);
  function fetchData(cog_id) {
    try {
      axios({
        method: 'get',
        url: "/api/map/" + cog_id,
        headers: _APP_JSON_HEADER
      }).then((response) => {
        let mapper = {}
        let crs_name_mapper = {}

        response.data["all_gcps"].forEach((element, index) => {

          let color_ = [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]
          mapper[element['gcp_id']] = {
            "color": color_,
            "x_dms": dec2dms(response.data["all_gcps"][index]['longitude']),
            "y_dms": dec2dms(response.data["all_gcps"][index]['latitude']),
          }
        });

        // if item projection is failed or duplicate dont show
        // if it is validated and not in cdr don't show since 
        // we have that projection in the cdr which will be the same thing but in_cdr will be true
        response.data['proj_info'] = response.data['proj_info'].filter(item => !(item.status === "validated" && item.in_cdr === false) && item.status !== "failed" && item.status !== "duplicate");
        response.data["proj_info"].forEach((element, index) => {
          element['provenance'] = element['system'] + "_" + element['system_version']
          crs_name_mapper[element['crs']] = null
          element['gcps'].forEach((point, index_) => {
            crs_name_mapper[point['crs']] = null
            point['color'] = mapper[point['gcp_id']]['color']
            point['x_dms'] = mapper[point['gcp_id']]['x_dms']
            point['y_dms'] = mapper[point['gcp_id']]['y_dms']
            point['provenance'] = point['system'] + "_" + point['system_version']
          })
        })
        getProjectionNames(crs_name_mapper).then(updatedMapper => {
          response.data["crs_names"] = updatedMapper
          setMapData(response.data)
        })
      })
    } catch {
      console.log('no file found for extracted gcps')
    }
  }



  return (
    <>
      {mapData ?
        <MapPage key={cog_id} cog_id={cog_id} mapData={mapData} />
        :
        <div>Loading</div>
      }

    </>
  );
}

export default ProjectionViewer
