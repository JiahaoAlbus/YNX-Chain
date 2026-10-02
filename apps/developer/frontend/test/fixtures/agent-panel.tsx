import { createRoot } from 'react-dom/client';
import { AgentPanel } from '../../src/chat/AgentPanel';
import '../../src/styles.css';

declare global { interface Window { __agentGuestApplied: number[]; } }
window.__agentGuestApplied = [];
createRoot(document.getElementById('root')!).render(<aside className="sidebar" style={{ width: 350, height: '100vh' }}><AgentPanel projectId="guest-project-must-not-be-used" revision={999} activePath="guest-private.ts" onApplied={revision => window.__agentGuestApplied.push(revision)} /></aside>);
