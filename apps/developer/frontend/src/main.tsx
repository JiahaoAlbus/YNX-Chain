import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { NativeToolsPage } from "./codeoss/NativeToolsPage";
import { Workbench } from "./app/Workbench";
import { WorkspaceRecoveryGate } from "./app/WorkspaceRecoveryGate";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{window.location.pathname === "/native-tools" ? <NativeToolsPage /> : <WorkspaceRecoveryGate><Workbench /></WorkspaceRecoveryGate>}</React.StrictMode>);
