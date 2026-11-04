import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FournisseurSession } from "./session";
import "./styles.css";

createRoot(document.getElementById("racine")!).render(
  <StrictMode>
    <FournisseurSession>
      <App />
    </FournisseurSession>
  </StrictMode>,
);
