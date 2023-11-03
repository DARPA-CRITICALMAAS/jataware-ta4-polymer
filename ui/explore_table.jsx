import React, { useState, useEffect, useRef } from 'react';
import axios from "axios";

import './css/landingPage.css'
import { Button, TextField, Table, TableBody, TableRow, TableCell, Paper, TableHead } from '@mui/material';
import { useNavigate } from "react-router-dom";
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { validate } from 'uuid';

function ExploreTable() {
    const navigate = useNavigate();
    const [mapsList, setMapsList] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filteredMaps, setFilteredMaps] = useState();
    const isGeoreferenced = useRef(true);
    const isValidated = useRef(true);

    const loadMapsList = async () => {
        try {
            let { data } = await axios({
                method: "get",
                url: "/api/map/maps" + "?georeferenced=" + isGeoreferenced.current + "&validated=" + isValidated.current,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "application/json",
                },
            })
            let { maps } = data;
            console.log(maps)
            setMapsList(maps.sort((a, b) => {
                if (a.georeferenced && !b.georeferenced) {
                    return 1;
                }
                if (!a.georeferenced && b.georeferenced) {
                    return -1;
                }
                return 0;
            }))

            setFilteredMaps(maps);


        } catch (error) {
            console.error("Error fetching data:", error);
        }
    }

    useEffect(() => {
        loadMapsList();
    }, []);

    useEffect(() => {
        if (searchTerm === '') {
            setFilteredMaps(mapsList);
        } else {
            setFilteredMaps(mapsList.filter(item => item['map_name'].includes(searchTerm)));
        }
    }, [searchTerm, mapsList]);

    function handleMapClick(map_info, path) {
        navigate("/" + path + "/" + map_info['map_id']);
    }

    function returnRowColor(map) {
        if (map['validated']) return "#3a9679"
        if (map['georeferenced']) return '#fabc60'
        return '#e16262'
    }

    const handleGeoreferenceChange = (event) => {
        isGeoreferenced.current = event.target.checked;
        loadMapsList()
    };
    const handleValidatedChange = (event) => {
        isValidated.current = event.target.checked
        loadMapsList()
    };

    return (<>
        {filteredMaps &&

            <div className="Landing container" >
                <header className="AppHeader">
                    <h1>Explore Maps</h1>
                    <br />

                </header>
                <div style={{ marginBottom: "100px" }}>

                    <FormControlLabel
                        control={<Switch checked={isGeoreferenced.current} onChange={handleGeoreferenceChange} />}
                        label="Georeferenced"
                    />
                    <FormControlLabel
                        control={<Switch checked={isValidated.current} onChange={handleValidatedChange} />}
                        label="Validated"
                    />
                    <h2>Search found maps</h2>
                    <h4>found: {mapsList.length}</h4>
                    <TextField
                        label="Search"
                        variant="outlined"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        fullWidth
                    />
                    <Paper style={{ marginTop: '20px', marginBottom: "200px", maxHeight: 500, minWidth: 800, overflow: 'auto' }}>
                        <Table style={{ marginBottom: "100px" }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell
                                        style={{
                                            position: "sticky",
                                            top: 0,
                                            zIndex: 1,
                                            backgroundColor: "white"
                                        }}>
                                        Map Name
                                    </TableCell>


                                    <TableCell
                                        style={{
                                            position: "sticky",
                                            top: 0,
                                            zIndex: 1,
                                            backgroundColor: "white"
                                        }}>

                                    </TableCell>
                                    <TableCell
                                        style={{
                                            position: "sticky",
                                            top: 0,
                                            zIndex: 1,
                                            backgroundColor: "white"
                                        }}>
                                    </TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {filteredMaps.map((item, index) => (
                                    <TableRow key={item['map_id']}
                                        style={{
                                            backgroundColor: returnRowColor(item)
                                        }} >
                                        <TableCell key={item['id']} ><b>{item['map_name']}</b></TableCell>

                                        {!item['validated'] ?
                                            <>
                                                <TableCell >
                                                    <Button variant="contained" onClick={() => { handleMapClick(item, "points") }}>Georeference</Button>
                                                </TableCell>
                                                <TableCell >
                                                    <Button disabled={!item['georeferenced']} variant="contained" onClick={() => { handleMapClick(item, "projections") }}>View Projections</Button>
                                                </TableCell>
                                            </>
                                            :
                                            <>
                                                <TableCell >
                                                    <Button variant="contained" onClick={() => { downloadProjection(item) }}>Download Projection</Button>
                                                </TableCell>
                                                <TableCell >
                                                    <Button variant="contained" onClick={() => { handleMapClick(item, "projections") }}>View Projection</Button>
                                                </TableCell>
                                            </>
                                        }


                                    </TableRow>

                                ))}
                            </TableBody>
                        </Table>
                    </Paper>
                </div>
            </div>
        }
    </>
    );
}

export default ExploreTable;
