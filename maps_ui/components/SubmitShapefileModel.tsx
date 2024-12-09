import React, { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Modal from "@mui/material/Modal";
import Typography from "@mui/material/Typography";
import { useDropzone } from "react-dropzone";
import JSZip from "jszip";
import * as shapefile from "shapefile";
import LoadingButton from "@mui/lab/LoadingButton";
import Tooltip from "./Tooltip";
import axios from "axios";

import {
    useIsFetching,
    useIsMutating,
    useQuery,
    useMutation,
} from "@tanstack/react-query";
export default function SubmitShapefileButtonModal({ cog_id }) {
    const [file, setFile] = useState(null);
    const [validationError, setValidationError] = useState("");
    const [errorMessage, setErrorMessage] = useState("");
    const [lastJobId, setLastJobId] = useState("");
    const handleShpClose = () => {
        setFile(null);
        setValidationError("")
        setErrorMessage("")
        setLastJobId("")
        submitZip.reset()
        setShpOpenReview(false);
    };

    const [openShpReview, setShpOpenReview] = useState(false);

    const submitZip = useMutation({
        mutationFn: async (file) => {
            const formData = new FormData();
            formData.append("file", file); // append the file to FormData

            return axios({
                method: "POST",
                url: `/api/map/upload_shapefiles_zip`, // Replace with your endpoint
                params: { cog_id },
                timeout: 5 * 60 * 1000, // 5 minutes timeout
                headers: {
                    "Content-Type": "multipart/form-data", // Ensure file upload works
                },
                data: formData,
            });
        },
        onError: (e) => {

            setErrorMessage(e.response.data.detail)
        },
        onSuccess: (response) => {
            const { job_id } = response.data;
            setLastJobId(job_id)

        },
    });


    const onDrop = (acceptedFiles) => {
        submitZip.reset()
        setErrorMessage("")
        setValidationError("")
        const zipFile = acceptedFiles.find((file) => file.type === "application/zip");

        if (!zipFile) {
            setValidationError("Please upload a valid .zip file.");
            return;
        }

        setValidationError("");
        setFile(zipFile);
        validateZipContents(zipFile);
    };

    const validateZipContents = (zipFile) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const zip = await JSZip.loadAsync(e.target.result);
                const shpFile = Object.keys(zip.files).find((filename) => filename.endsWith(".shp"));
                const dbfFile = Object.keys(zip.files).find((filename) => filename.endsWith(".dbf"));
                const prjFiles = Object.keys(zip.files).filter((filename) => filename.endsWith(".prj"));
                const shpFiles = Object.keys(zip.files).filter((filename) => filename.endsWith(".shp"));
                const missingPrjFiles = shpFiles.filter((shpFile) => {
                    const prjFile = shpFile.replace(".shp", ".prj");
                    return !prjFiles.includes(prjFile);
                });

                if (!shpFile || !dbfFile) {
                    setValidationError("Missing .shp or .dbf file in the zip.");
                    return;
                }

                const dbfContent = await zip.files[dbfFile].async("arraybuffer");
                const shpContent = await zip.files[shpFile].async("arraybuffer");

                const source = await shapefile.open(shpContent, dbfContent);
                const firstRecord = await source.read();

                if (firstRecord.done) {
                    setValidationError("Shapefile is empty.");
                    return;
                }

                // Check if the "LABEL" field exists in the first feature's properties
                const fieldNames = Object.keys(firstRecord.value.properties);
                if (!fieldNames.includes("LABEL")) {
                    setValidationError("Shapefile does not contain a 'LABEL' field.");
                    setFile(null);

                    return;
                }

                setValidationError("");
                if (missingPrjFiles.length > 0) {
                    setValidationError(`Missing .prj file(s) for: ${missingPrjFiles.join(", ")}`);
                    setFile(null);
                }
            } catch (error) {
                setValidationError("Error reading the zip file.");
                setFile(null);
            }

        };

        reader.readAsArrayBuffer(zipFile);
    };

    const handleSubmit = () => {
        if (!file) {
            alert("No file selected!");
            return;
        }

        if (validationError) {
            alert(validationError);
            return;
        }
        submitZip.mutate(file, cog_id);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ".zip",
    });

    return (
        <>
            <Tooltip
                title="
      Upload georeferenced features
            "
                arrow
            >
                <Button variant="contained" onClick={() => setShpOpenReview(true)}>

                    Upload
                </Button>

            </Tooltip>
            <Modal
                open={openShpReview}
                onClose={handleShpClose}
                aria-labelledby="modal-title"
                aria-describedby="modal-description"
            >
                <Box
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: "40%",
                        bgcolor: "background.paper",
                        boxShadow: 24,
                        p: 4,
                        borderRadius: "15px"
                    }}
                >

                    <Box
                        sx={{
                            maxHeight: 300, // Adjust the height as needed
                            overflowY: "auto",
                            padding: 2,
                            border: "1px solid #ccc", // Optional border for a cleaner look
                            borderRadius: "4px",
                        }}
                    >
                        <Typography variant="h6" gutterBottom>
                            Upload a zip of shapefiles to the CDR.
                        </Typography>
                        <Typography variant="body2" paragraph>
                            In the zip, you should include shapefiles for points, lines, and polygons. Each shapefile must have an associated .prj file. The latest upload will overwrite any previously uploaded features from this UI.
                        </Typography>
                        <Typography variant="body2" paragraph>
                            Each shapefile must contain a <strong>LABEL</strong> field. Recommended additional fields are:
                        </Typography>
                        <ul>
                            <li><Typography variant="body2">ABBRV: abbreviation</Typography></li>
                            <li><Typography variant="body2">DESCR: description</Typography></li>
                        </ul>
                        <Typography variant="body2" paragraph>
                            Additional fields for specific types are listed below:
                        </Typography>
                        <Typography variant="body2" paragraph>
                            <strong>Type: Point</strong>
                            <ul>
                                <li><Typography variant="body2">DIP: int</Typography></li>
                                <li><Typography variant="body2">DIP_DIRECT: int</Typography></li>
                            </ul>
                        </Typography>
                        <Typography variant="body2" paragraph>
                            <strong>Type: LineString</strong>
                            <ul>
                                <li><Typography variant="body2">DASH_PATT: string (allowed options:"","solid","dash", "dotted")</Typography></li>
                                <li><Typography variant="body2">SYMBOL: string</Typography></li>
                            </ul>
                        </Typography>
                        <Typography variant="body2" paragraph>
                            <strong>Type: Polygon</strong>
                            <ul>
                                <li><Typography variant="body2">PATTERN: string</Typography></li>
                                <li><Typography variant="body2">COLOR: string</Typography></li>
                                <li><Typography variant="body2">MU_TEXT: string (map unit age name, e.g., Cambrian)</Typography></li>
                                <li><Typography variant="body2">MU_B_AGE: int (youngest age of map unit)</Typography></li>
                                <li><Typography variant="body2">MU_T_AGE: int (oldest age of map unit)</Typography></li>
                                <li><Typography variant="body2">MU_LITH: string (lithology name)</Typography></li>
                            </ul>
                        </Typography>
                    </Box>


                    <Box
                        {...getRootProps()}
                        sx={{
                            border: "2px dashed #ccc",
                            padding: "20px",
                            textAlign: "center",
                            mb: 2,
                            cursor: "pointer",
                            backgroundColor: isDragActive ? "#f0f0f0" : "transparent",
                        }}
                    >
                        <input {...getInputProps()} />
                        {file ? (
                            <Typography variant="body2">{file.name}</Typography>
                        ) : (
                            <Typography variant="body2">
                                {isDragActive ? "Drop the file here..." : "Drag 'n' drop a .zip file here, or click to select one"}
                            </Typography>
                        )}
                    </Box>

                    {validationError && (
                        <Typography color="error" variant="body2" mb={2}>
                            {validationError}
                        </Typography>
                    )}
                    <LoadingButton
                        loading={Boolean(submitZip.isPending)}
                        loadingIndicator="Waiting…"
                        disabled={!file || Boolean(validationError)}
                        onClick={() => handleSubmit()}
                        variant="contained"
                        fullWidth
                    >
                        Submit to CDR
                    </LoadingButton>
                    {submitZip.isSuccess && (
                        <Typography style={{ color: "var(--mui-palette-success-dark)" }} variant="body2" mb={2}>
                            Success Job Id {lastJobId}
                        </Typography>
                    )

                    }
                    {submitZip.isError && (
                        <Typography style={{ color: "var(--mui-palette-error-main)" }} variant="body2" mb={2}>
                            Failed to submit to cdr {errorMessage}
                        </Typography>
                    )

                    }
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => {

                            handleShpClose()
                        }}
                        fullWidth
                        sx={{ mt: 2 }}
                    >
                        Close
                    </Button>
                </Box>
            </Modal>
        </>

    );
}
