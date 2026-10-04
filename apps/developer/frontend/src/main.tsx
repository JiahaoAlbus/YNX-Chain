import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { lazy, Suspense, useEffect, useState } from 'react';
import { createHostEntry } from './desktop/host-commands';
import { isPublicDeveloperEntry } from './public-site/entry';

const nativeHome = window.location.pathname === '/projects' || !window.ynxDesktopWorkspace && ['/', '/index.html'].includes(window.location.pathname);
const GuestWorkspace = lazy(() => import('./app/GuestWorkspace'));
const DeveloperSite = lazy(() => import('./public-site/DeveloperSite'));
const NativeIDEHome = lazy(() => import('./codeoss/NativeIDEHome').then(module => ({ default: module.NativeIDEHome })));
const NativeToolsPage = lazy(() => import('./codeoss/NativeToolsPage').then(module => ({ default: module.NativeToolsPage })));
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
// Native presentation markers select the existing app; they grant no identity,
// project admission or command authority. WebView2 acceptance also uses root.
const nativePresentation = window.ynxDesktopWorkspace || (window as unknown as { chrome?: { webview?: unknown } }).chrome?.webview;
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Suspense fallback={<main role="status">YNX Developer…</main>}>{isPublicDeveloperEntry(window.location, nativePresentation) ? <DeveloperSite /> : <DeveloperEntry />}</Suspense></React.StrictMode>);
