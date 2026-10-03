import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeMatrixMediaViewer } from '../../src/NativeMatrixMediaViewer';
import { MatrixMediaPreview } from '../../src/nativeMatrixMedia';

// Public-fixture-only component rendering, not canonical/native authorization.
// The original controller validates its file:// fixture DTO. Only this browser
// fixture adapter maps the public logo to HTTP so React Native Web can display it.
const released = [];
let rejectNext = false;
const originalRoom = '!fixture:example.test';
const preview = new class extends MatrixMediaPreview {
  async open(roomId, eventId) {
    const lease = await super.open(roomId, eventId);
    return { ...lease, uri: '/logo.png?event=' + encodeURIComponent(eventId) };
  }
}({
  async open(roomId, eventId) {
    if (rejectNext) { rejectNext = false; throw new Error('FIXTURE_PORT_REJECTION'); }
    return { leaseId: crypto.randomUUID(), roomId, eventId, filename: 'Public original YNX logo.png',
      mimeType: 'image/png', bytes: 1, uri: 'file:///public-fixture/ynx-logo.png', imagePreview: true };
  },
  async release(leaseId) { released.push(leaseId); },
}, async () => {});

function App() {
  const [eventId, setEventId] = useState('$first');
  const [records, setRecords] = useState([]);
  const [notice, setNotice] = useState('');
  const view = useRef(null);
  useLayoutEffect(() => {
    // Runs after DOM commit but before passive useEffect cleanup in the viewer.
    // Captures whether the old Image actually exists at the transition commit.
    const image = view.current?.querySelector('[aria-label="Original received image"]');
    setRecords(current => [...current, { eventId, layoutImagePresent: Boolean(image),
      layoutImageHTML: image?.outerHTML ?? null }]);
  }, [eventId]);
  return <main style={{ maxWidth: 760, margin: '0 auto', fontFamily: 'Georgia, serif', padding: 20 }}>
    <h1>YNX Social attachment render check</h1>
    <p>Engineering fixture only. Actual viewer and controller; public logo only. No Matrix server,
      wallet, account authorization, private file, cloud classifier or native installation.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <button onClick={() => setEventId(current => current === '$first' ? '$second' : '$first')}>Switch original fixture event</button>
      <button onClick={() => { rejectNext = true; setNotice('The next explicit open will reject in the fixture port.'); }}>Reject next open (fixture)</button>
    </div>
    <p role="status">{notice}</p>
    <div ref={view} style={{ height: 600, border: '1px solid #c7d4e5' }}>
      <NativeMatrixMediaViewer preview={preview} roomId={originalRoom} eventId={eventId}
        onClose={() => setNotice('Preview closed; original fixture message retained.')}
        onCleanupFailure={() => setNotice('Fixture cleanup failed.')} />
    </div>
    <h2>Commit-time scope observations</h2>
    <pre id="scope-records">{JSON.stringify(records, null, 2)}</pre>
    <p>Current original event: <code id="current-event">{eventId}</code></p>
    <p>Released original fixture leases: {released.length}</p>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
