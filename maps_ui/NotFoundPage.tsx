import { useRouteError } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import Text from "@mui/material/Typography";
import Button from "@mui/material/Button";

import Header from "./components/Header";
import Footer from "./components/Footer";

import "./css/not_found.scss";

export default function NotFoundPage() {
  const error = useRouteError();
  const navigate = useNavigate();

  return (
    <div className="not-found-root">
      <Header navigate={navigate} />
      <main>
        <Text variant="h2" color="warning.main">
          NOT FOUND
        </Text>
        <Text variant="h5" sx={{ textAlign: "center" }}>
          The page you are looking for does not exist, or you are missing
          parameters in the URL.
        </Text>
        <Text style={{ display: "none" }}>
          <span>{error?.message}</span>
        </Text>
        <Button
          style={{ marginTop: "0.5rem" }}
          link
          onClick={() => navigate("/")}
        >
          <Text>Back to Home</Text>
        </Button>
      </main>
      <Footer />
    </div>
  );
}
