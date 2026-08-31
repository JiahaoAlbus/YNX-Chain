import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { Workbench } from "./app/Workbench";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Workbench /></React.StrictMode>);
