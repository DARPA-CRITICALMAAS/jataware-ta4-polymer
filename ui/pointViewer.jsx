import React, { useState, useEffect } from 'react';
import MapPage from './components/mapExtraction.tsx'
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { dec2dms } from './components/helpers.js'

// import  dec2dms  from './components/helpers.js'

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
}
function PointViewer() {
    const { map_id } = useParams();
    const [georeferenced, _] = useState(false)
    const [mapData, setMapData] = useState(null)

    useEffect(() => {
        try {
            axios({
                method: 'GET',
                url: "/api/map/maps/" + map_id,
                headers: _APP_JSON_HEADER
            }).then((response) => {
                let mapper = {}
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
                });
                response.data["proj_info"].forEach((element, index) => {

                    element['gcps'].forEach((point, index_) => {
                        point['color'] = mapper[point['gcp_id']]['color']
                        point['x_dms'] = mapper[point['gcp_id']]['x_dms']
                        point['y_dms'] = mapper[point['gcp_id']]['y_dms']
                    })
                })
                setMapData(response.data)
            })
        } catch {
            console.log('AN ERROR OCCURED')
        }

    }, [])

    return (
        <>
            {mapData &&
                <MapPage mapData={mapData} />

            }
        </>
    );
}

export default PointViewer