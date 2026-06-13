import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ThemeProvider } from "./theme/index.tsx";
import "./i18n/index.ts";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
