import React, { useEffect, useRef, useState } from 'react';
import { AppState, Button, ScrollView, Text, View } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { createProductionFaucetTransport, faucetTransportReadiness } from '../../modules/ynx-faucet-transport';

// This entry is copied into a separately identified, network-disabled QA app.
// It is never imported by the Wallet's production entry.
const PREFIX = 'YNX_FAUCET_BRIDGE_QA_JS ';
type Snapshot = { engineCreated: boolean; foreground: boolean; destroyed: boolean; packageName: string };
type Row = { name: string; passed: boolean; code?: string; detail?: string };
const expectedPackage = 'com.ynxweb4.wallet.faucetbridgeqa';

function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'MISSING_CODE';
}

export default function ProbeApp() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState(String(AppState.currentState));
  const busy = useRef(false);
  const batches = useRef(0);
  const live = useRef(true);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    const batch = ++batches.current;
    const result: Row[] = [];
    const record = (row: Row) => { result.push(row); console.info(PREFIX + JSON.stringify({ batch, ...row })); };
    try {
      requireCondition(AppState.currentState === 'active', 'QA run requires the actual foreground Activity');
      requireCondition(createProductionFaucetTransport() === null && faucetTransportReadiness.productionEnabled === false,
        'The original production JS gate must remain disabled');
      const original = requireNativeModule('YnxFaucetTransport');
      const probe = requireNativeModule('YnxFaucetBridgeQA');
      const inspect = (): Snapshot => {
        const snapshot: Snapshot = probe.snapshot();
        requireCondition(snapshot.packageName === expectedPackage, 'Wrong QA package');
        requireCondition(snapshot.engineCreated === false && snapshot.destroyed === false, 'Unexpected original module state');
        return snapshot;
      };
      let snapshot = inspect();
      for (let attempt = 0; !snapshot.foreground && attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        snapshot = inspect();
      }
      requireCondition(snapshot.foreground, 'The original Expo module did not receive foreground lifecycle');
      record({ name: 'original-module-loaded-and-foreground', passed: true });
      for (const purpose of ['admit', 'rpc']) {
        let caught: unknown;
        try { original.reserveTask(purpose); } catch (error) { caught = error; }
        requireCondition(codeOf(caught) === 'YNX_HTTP_UNAVAILABLE', 'Synchronous reservation did not preserve the disabled gate');
        inspect();
        record({ name: `sync-reserve-${purpose}`, passed: true, code: codeOf(caught) });
      }
      const requests = [
        { purpose: 'rpc', taskId: 'qa-synthetic-task', rpcId: 'qa-synthetic-task', method: 'eth_chainId', params: [] },
        { purpose: 'admit', taskId: 'qa-synthetic-task', requestId: 'qa-synthetic-request', body: '{"qa":"synthetic"}' },
      ];
      for (const request of requests) {
        let caught: unknown;
        try { await original.request(request); } catch (error) { caught = error; }
        requireCondition(codeOf(caught) === 'YNX_HTTP_UNAVAILABLE', 'AsyncFunction did not reject through the original disabled gate');
        inspect();
        record({ name: `async-request-${request.purpose}`, passed: true, code: codeOf(caught) });
      }
      original.cancel('qa-synthetic-task');
      inspect();
      record({ name: 'cancel-does-not-create-an-engine', passed: true });
    } catch (error) {
      record({ name: 'batch-failure', passed: false, detail: error instanceof Error ? error.message : 'Unexpected QA failure' });
    } finally {
      busy.current = false;
      if (live.current) { setRows(result); setRunning(false); }
      console.info(PREFIX + JSON.stringify({ event: 'batch-complete', batch, passed: result.length === 6 && result.every(row => row.passed), rows: result.length }));
    }
  }

  useEffect(() => {
    live.current = true;
    let started = false;
    const tryStart = () => {
      if (started || AppState.currentState !== 'active') return;
      started = true;
      void run();
    };
    const subscription = AppState.addEventListener('change', next => {
      setState(String(next));
      console.info(PREFIX + JSON.stringify({ event: 'app-state', state: next, batches: batches.current }));
      // Only the first launch runs automatically. Foreground return is observed;
      // repeating the probe requires the explicit button below.
      tryStart();
    });
    tryStart();
    return () => { live.current = false; subscription.remove(); };
  }, []);

  const passed = rows.length === 6 && rows.every(row => row.passed);
  return <ScrollView style={{ backgroundColor: '#FFFFFF' }} contentContainerStyle={{ padding: 24, paddingTop: 64 }}>
    <Text style={{ color: '#002FA7', fontSize: 24, fontWeight: '700' }}>Faucet bridge QA</Text>
    <Text style={{ color: '#002FA7', marginVertical: 16 }}>Separate test app · production gate disabled</Text>
    <Text accessibilityLabel="bridge-qa-result" style={{ fontSize: 20, color: '#002FA7' }}>{running ? 'Running' : passed ? 'Bridge checks passed' : rows.length ? 'Bridge checks failed' : 'Waiting for foreground'}</Text>
    <Text style={{ marginVertical: 12 }}>Activity: {state} · Batches: {batches.current}</Text>
    {rows.map(row => <Text key={row.name} style={{ marginBottom: 8 }}>{row.passed ? 'PASS' : 'FAIL'} {row.name}{row.detail ? `: ${row.detail}` : ''}</Text>)}
    <View style={{ marginTop: 16 }}><Button title="Run bridge checks again" onPress={() => void run()} disabled={running || state !== 'active'} color="#002FA7" /></View>
  </ScrollView>;
}
