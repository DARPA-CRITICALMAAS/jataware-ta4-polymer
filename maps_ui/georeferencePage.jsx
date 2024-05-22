import React, { useState, useEffect } from 'react';
import GeoreferenceComponent from './components/georeferenceMap.tsx'
import axios from 'axios';
import { dec2dms } from './components/helpers.js'
import { useParams } from "react-router-dom";

// import  dec2dms  from './components/helpers.js'

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
}
function GeoreferencePage() {
    const { cog_id } = useParams();
    const [georeferenced, _] = useState(false)
    const [mapData, setMapData] = useState(null)

    useEffect(() => {
        fetchData(cog_id)
    }, [cog_id]);

    function fetchData(cog_id) {
        try {
            axios({
                method: 'GET',
                url: "/api/map/" + cog_id,
                headers: _APP_JSON_HEADER
            }).then((response) => {
                let mapper = {}
                response.data["provenances"] = []
                response.data["all_gcps"].forEach((element, index) => {
                    element['provenance'] = element['system'] + "_" + element['system_version']
                    element['height'] = response.data['cog_info']['height']
                    let color_ = [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]
                    mapper[element['gcp_id']] = {
                        "color": color_,
                        "x_dms": dec2dms(response.data["all_gcps"][index]['longitude']),
                        "y_dms": dec2dms(response.data["all_gcps"][index]['latitude'])
                    }
                    response.data["all_gcps"][index]['color'] = color_
                    response.data['all_gcps'][index]['x_dms'] = dec2dms(response.data["all_gcps"][index]['longitude'])
                    response.data['all_gcps'][index]['y_dms'] = dec2dms(response.data["all_gcps"][index]['latitude'])

                    response.data['all_gcps'][index]['just_edited'] = false

                    if (response.data["provenances"].includes(element['provenance'])) {
                        // pass
                    } else {

                        response.data["provenances"].push(element['provenance'])
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
                <GeoreferenceComponent key={cog_id} mapData={mapData} />
            }
        </>
    );
}

export default GeoreferencePage