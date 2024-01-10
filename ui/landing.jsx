import React, { useState, useEffect } from 'react';
import axios from "axios";
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack'

import './css/landingPage.css'
import { Button, TextField, Table, TableBody, TableRow, TableCell, Paper, TablePagination, TableHead } from '@mui/material';
// import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, , Paper } from '@mui/material';

import { useNavigate } from "react-router-dom";

function Landing() {
  const navigate = useNavigate();
  const [mapsList, setMapsList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  // const [filteredMaps, setFilteredMaps] = useState();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [showPagination, setShowPagination] = useState(false)
  const [statCounts, setStatCounts] = useState({})
  const loadStats = async () => {
    try {
      let { data } = await axios({
        method: "get",
        url: "/api/map/maps_stats",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },

      })

      setStatCounts(data);

    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }


  const loadMapsList = async () => {
    try {
      console.log(rowsPerPage / 2)
      let { data } = await axios({
        method: "post",
        url: "/api/map/maps_search",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        data: {
          "query": "",
          "page": page,
          "size": rowsPerPage / 2,
          "georeferenced": false,
          "random": true
        },
      })
      let maps = data['results']
      let georefed = await axios({
        method: "post",
        url: "/api/map/maps_search",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        data: {
          "query": "",
          "page": page,
          "size": rowsPerPage / 2,
          "georeferenced": true,
          "random": true
        },
      })
      maps = maps.concat(georefed['data']['results'])
      setMapsList(maps.sort((a, b) => {
        if (a.georeferenced && !b.georeferenced) {
          return 1;
        }
        if (!a.georeferenced && b.georeferenced) {
          return -1;
        }
        return 0;
      }))

      setMapsList(maps);

    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }

  const paginateMaps = async () => {
    try {
      console.log(searchTerm, page, rowsPerPage)
      let { data } = await axios({
        method: "post",
        url: "/api/map/maps_search",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        data: {
          "query": searchTerm,
          "page": page,
          "size": rowsPerPage,
          "georeferenced": true,
          "random": false
        },
      })
      let maps = data['results']

      setMapsList(maps.sort((a, b) => {
        if (a.georeferenced && !b.georeferenced) {
          return 1;
        }
        if (!a.georeferenced && b.georeferenced) {
          return -1;
        }
        return 0;
      }))

      setMapsList(maps);

    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }

  const oneMap = async (status) => {
    let post_data = {
      "query": "",
      "page": 1,
      "size": 1,
      "georeferenced": true,
      "validated": false,
      "random": true
    }
    let nav_path = './projections/'
    if (status == "not_georeferenced") {
      nav_path = './points/'
      post_data["georeferenced"] = false
    }
    if (status == "validated") {
      post_data["validated"] = true
    }

    try {
      let { data } = await axios({
        method: "post",
        url: "/api/map/maps_search",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        data: post_data
      })
      console.log(data)
      if (data['results'].length > 0) {
        navigate(nav_path + data["results"][0]['map_id'])
      }

    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }


  useEffect(() => {
    // on page load get random 5 georeference and 5 non georeferenced maps
    document.title = "Nylon Georeferencer";
    loadMapsList();
    loadStats()
  }, []);

  useEffect(() => {
    // on page load get random 5 georeference and 5 non georeferenced maps
    paginateMaps();
  }, [page, rowsPerPage]);


  function handleMapClick(map_info, path) {
    navigate("./" + path + "/" + map_info['map_id']);
  }

  function returnRowColor(map) {
    if (map['validated']) return "#3a9679"
    if (map['georeferenced']) return '#fabc60'
    return '#e16262'
  }

  function submitSearch() {
    setPage(0)
    setRowsPerPage(10)
    paginateMaps();
    setShowPagination(true)

  }

  function fetchRandomMaps() {
    setSearchTerm("")
    setPage(0)
    setRowsPerPage(10)
    loadMapsList();
    setShowPagination(false)
  }

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(+event.target.value);
    setPage(0);
  };
  function navigateToMap(mapStatus) {
    console.log(mapStatus)
    oneMap(mapStatus)
  }

  return (<>
    {mapsList &&

      <div className="Landing container" >
        <header className="AppHeader">
          <h1 >Georeferencer</h1>
          <div className="stats_container">

            <div className="stat_nav">
              <h2 style={{ margin: "auto" }}>Take me to a Map:</h2>
              <Button onClick={() => { navigateToMap('georeferenced') }}>georeferenced ({statCounts['georeferenced']})</Button>
              <Button onClick={() => { navigateToMap('not_georeferenced') }}>not georeferenced ({statCounts['not_georeferenced']})</Button>
              <Button onClick={() => { navigateToMap('validated') }}>validated {statCounts['validated']}</Button>
              <br></br>
              <b style={{ margin: "auto" }}>
                Total Maps: {statCounts['validated'] + statCounts['georeferenced'] + statCounts['not_georeferenced']}

              </b>
            </div>
          </div>

          <br />
        </header>

        <div style={{ marginBottom: "100px" }}>

          <TextField
            label="Search for a map"
            variant="outlined"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            fullWidth
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitSearch()
              }
            }}
          />
          <Button onClick={() => { submitSearch() }}>Submit</Button>
          <Button onClick={() => { fetchRandomMaps() }}>Random Maps</Button>

          <Paper style={{ marginTop: '20px', marginBottom: "500px", maxHeight: 500, minWidth: 800, overflow: 'auto' }}>
            {showPagination &&
              <TablePagination
                component="div"
                count={1000} // This should ideally be the total number of results. You can get this from result.data.hits.total.value
                page={page}
                onPageChange={handleChangePage}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={handleChangeRowsPerPage}
              />
            }
            <Table style={{ marginBottom: "200px" }}>
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
                    Georeferenced
                  </TableCell>
                  <TableCell
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      backgroundColor: "white"
                    }}>
                    Validated
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
                {mapsList.map((item, index) => (
                  <TableRow key={item['map_id']}
                    style={{
                      backgroundColor: returnRowColor(item)
                    }} >
                    <TableCell key={item['id']} ><b>{item['map_name']}</b></TableCell>
                    <TableCell >{String(item['georeferenced']).toUpperCase()}</TableCell>
                    <TableCell >{String(item['validated']).toUpperCase()}</TableCell>

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

export default Landing;
