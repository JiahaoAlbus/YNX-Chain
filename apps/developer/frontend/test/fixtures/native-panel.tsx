import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeIDEPanel } from '../../src/codeoss/NativeIDEPanel';
import '../../src/styles.css';
const ownership = (value: boolean) => ((window as any).ownership ||= []).push(value);
function Fixture() {
  const [project, select] = useState('A');
  (window as any).selectGuest = select;
  return <aside className="sidebar" style={{ width: 350, height: '100vh' }}><NativeIDEPanel projectId={project} projectName="Guest" revision={1} admitted={true} onOwnershipChange={ownership} /></aside>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
