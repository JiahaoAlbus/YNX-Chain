import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { NativeToolsPage } from "./codeoss/NativeToolsPage";
import { NativeIDEHome } from './codeoss/NativeIDEHome';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createHostEntry } from './desktop/host-commands';

const nativeHome = window.location.pathname === '/projects' || !window.ynxDesktopWorkspace && ['/', '/index.html'].includes(window.location.pathname);
const GuestWorkspace = lazy(() => import('./app/GuestWorkspace'));
function DeveloperEntry() {
  const [home, setHome] = useState(nativeHome);
  useEffect(() => {
    if (!home || window.location.pathname === '/native-tools') return;
    if (window.__ynxDesktopHost) return;
    const previous = window.__ynxDesktopHost, entry = createHostEntry(window, () => setHome(false));
    window.__ynxDesktopHost = entry;
    return () => { if (window.__ynxDesktopHost === entry) { if (previous) window.__ynxDesktopHost = previous; else delete window.__ynxDesktopHost; } };
    // Retain the not-ready entry bridge while the recovery chunk loads.
    // Workbench replaces it only after its project and editor are ready.
  }, []);
  return window.location.pathname === '/native-tools' ? <NativeToolsPage /> : home ? <NativeIDEHome /> : <Suspense fallback={<main role="status">Opening saved workspace…</main>}><GuestWorkspace /></Suspense>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><DeveloperEntry /></React.StrictMode>);
