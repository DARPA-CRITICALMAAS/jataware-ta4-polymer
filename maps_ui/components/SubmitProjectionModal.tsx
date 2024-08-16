import React, { useEffect, useRef, useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Modal from "@mui/material/Modal";
import Typography from "@mui/material/Typography";

export default function SubmitProjectionModal({ open, handleClose, save }) {
  return (
    <Modal
      open={open}
      onClose={handleClose}
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
    >
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 400,
          bgcolor: "background.paper",
          border: "2px solid #000",
          boxShadow: 24,
          p: 4,
        }}
      >
        <Typography id="modal-description" variant="body1" mb={2}>
          Are you sure you want to <b>validate and submit</b> this projection to CDR?
        </Typography>
        <Button color="success" onClick={save}>
          Yes
        </Button>
        <Button color="error" onClick={handleClose}>
          No
        </Button>
      </Box>
    </Modal>
  );
}
