import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from "react-router-dom";

function FileUploadForm({ setLoading }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const navigate = useNavigate();
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file && (file.type === 'image/tiff' || file.type === 'application/pdf')) {
      setSelectedFile(file);
    } else {
      // Handle invalid file type
      alert('Please select a .tiff or .pdf file.');
    }
  };

  const handleFileUpload = () => {
    if (selectedFile) {
      setLoading(true)
      const formData = new FormData();
      formData.append('file', selectedFile);
      axios.post("/api/map/processMap", formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }).then((response) => {
        // Handle the response from the FastAPI endpoint
        let resp = response.data
        setLoading(false)
        if (resp.georeferenced === true) {
          navigate('/projections/' + resp['map_id'])
        } else {
          navigate('/points/' + resp['map_id'])
        }
      })
        .catch((error) => {
          // Handle any errors
          setLoading(false)
          console.error(error);
        });
    } else {
      // Handle the case where no file is selected
      alert('Please select a file before uploading.');
    }
  };

  return (
    <>

      <div style={{ display: "flex", alignItems: "center", margin: "10px" }}>
        <h4>Upload Map to CDR (.pdf, .tif, .tiff)</h4>
        <input style={{ marginLeft: "5px", width: "200px" }} type="file" accept=".tif, .tiff, .pdf" onChange={handleFileChange} />
        <button style={{ margin: "2px" }} onClick={handleFileUpload}>Upload</button>
      </div>
    </>

  );
}


export default FileUploadForm;
