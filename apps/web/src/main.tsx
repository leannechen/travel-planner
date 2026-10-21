import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./AuthProvider";
import { authFromEnv } from "./authConfig";
import { PreferencesProvider } from "./preferences";
import "./styles.css";

const auth = authFromEnv();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreferencesProvider>
      <AuthProvider client={auth}>
        <App />
      </AuthProvider>
    </PreferencesProvider>
  </StrictMode>,
);
