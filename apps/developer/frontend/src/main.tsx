import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { NativeToolsPage } from "./codeoss/NativeToolsPage";
import { Workbench } from "./app/Workbench";
import { WorkspaceRecoveryGate } from "./app/WorkspaceRecoveryGate";
import { NativeIDEHome } from './codeoss/NativeIDEHome';
import { useEffect, useState } from 'react';
import { createHostEntry } from './desktop/host-commands';

const nativeHome = window.location.pathname === '/projects' || !window.ynxDesktopWorkspace && ['/', '/index.html'].includes(window.location.pathname);
function DeveloperEntry() {
  const [home, setHome] = useState(nativeHome);
  useEffect(() => {
    if (!home || window.location.pathname === '/native-tools') return;
    const previous = window.__ynxDesktopHost, entry = createHostEntry(window, () => setHome(false));
    window.__ynxDesktopHost = entry;
    return () => { if (window.__ynxDesktopHost === entry) { if (previous) window.__ynxDesktopHost = previous; else delete window.__ynxDesktopHost; } };
  }, [home]);
  return window.location.pathname === '/native-tools' ? <NativeToolsPage /> : home ? <NativeIDEHome /> : <WorkspaceRecoveryGate><Workbench /></WorkspaceRecoveryGate>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><DeveloperEntry /></React.StrictMode>);
