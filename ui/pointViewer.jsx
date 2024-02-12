import React, { useState, useEffect } from 'react';
import MapPage from './components/mapExtraction.tsx'
import axios from 'axios';
import { dec2dms } from './components/helpers.js'
import { useParams } from "react-router-dom";

// import  dec2dms  from './components/helpers.js'

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
}
function PointViewer() {
    const { map_id } = useParams();
    const [georeferenced, _] = useState(false)
    const [mapData, setMapData] = useState(null)

    useEffect(() => {
        fetchData(map_id)
    }, [map_id]);

    function fetchData(map_id) {
        try {
            axios({
                method: 'GET',
                url: "/api/map/" + map_id,
                headers: _APP_JSON_HEADER
            }).then((response) => {
                let mapper = {}
                response.data["provenances"] = []
                response.data["all_gcps"].forEach((element, index) => {
                    let color_ = [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]
                    mapper[element['gcp_id']] = {
                        "color": color_,
                        "x_dms": dec2dms(response.data["all_gcps"][index]['x']),
                        "y_dms": dec2dms(response.data["all_gcps"][index]['y'])
                    }
                    response.data["all_gcps"][index]['color'] = color_
                    response.data['all_gcps'][index]['x_dms'] = dec2dms(response.data["all_gcps"][index]['x'])
                    response.data['all_gcps'][index]['y_dms'] = dec2dms(response.data["all_gcps"][index]['y'])

                    response.data['all_gcps'][index]['just_edited'] = false

                    if (response.data["provenances"].includes(response.data["all_gcps"][index]['provenance'])) {
                        // pass
                    } else {

                        response.data["provenances"].push(response.data["all_gcps"][index]['provenance'])
                    }
                });
                setMapData(response.data)
            })
        } catch {
            console.log('AN ERROR OCCURED')
        }

    }

    return (
        <>
            {mapData &&
                <MapPage key={map_id} mapData={mapData} />
            }
        </>
    );
}

export default PointViewer