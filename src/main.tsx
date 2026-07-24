import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SudokuApp from "@/src/components/SudokuApp";
import "@/src/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <SudokuApp />
  </StrictMode>,
);
