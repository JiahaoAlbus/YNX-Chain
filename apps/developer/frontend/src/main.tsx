import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { NativeToolsPage } from "./codeoss/NativeToolsPage";
import { Workbench } from "./app/Workbench";
import { WorkspaceRecoveryGate } from "./app/WorkspaceRecoveryGate";
import { NativeIDEHome } from './codeoss/NativeIDEHome';

declare global { interface Window { ynxHostedDesktop?: boolean } }
const nativeHome = !window.ynxDesktopWorkspace && !window.ynxHostedDesktop && ['/', '/index.html'].includes(window.location.pathname);
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{window.location.pathname === "/native-tools" ? <NativeToolsPage /> : nativeHome ? <NativeIDEHome /> : <WorkspaceRecoveryGate><Workbench /></WorkspaceRecoveryGate>}</React.StrictMode>);
