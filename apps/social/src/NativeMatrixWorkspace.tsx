import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import type { MatrixEvent, NativeMatrixConsumer } from './nativeMatrix';

// Mounted by the existing product identity integration, never by a discovered
// URL or Wallet account alone. No custom envelope fallback in this workspace.
export function NativeMatrixWorkspace({ client, personId, onClose }: {
  client: NativeMatrixConsumer; personId: string; onClose: () => void;
}) {
  const [events, setEvents] = useState<MatrixEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Restore your native Matrix session to continue.');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sas, setSas] = useState<{ revision: number; values: string[] }>();
  const mounted = useRef(true);
  const intent = useRef<{ id: string; body: string } | undefined>(undefined);
  const showError = (error: unknown) => {
    if (mounted.current) setStatus(error instanceof Error ? error.message : 'Matrix operation needs review.');
  };
  useEffect(() => {
    mounted.current = true;
    const stop = client.listen(event => {
      if (!mounted.current) return;
      if (event.type === 'locked') { setReady(false); setEvents([]); setSas(undefined); }
      if (event.type === 'timeline') setEvents(event.events ?? []);
      if (event.type === 'sas' && event.revision && event.values) setSas({ revision: event.revision, values: event.values });
      if (event.type === 'sdk-sent-needs-readback') setStatus('SDK sent event observed. Authenticated readback and Social index still need confirmation.');
      if (event.type === 'verification-finished') { setSas(undefined); setStatus('SDK verification finished.'); }
      if (event.type === 'verification-cancelled' || event.type === 'verification-failed') { setSas(undefined); setStatus(event.type); }
      if (event.type === 'native-journal-error') { setReady(false); setStatus('Original send journal needs recovery. Do not send a replacement.'); }
    });
    const background = AppState.addEventListener('change', state => { if (state !== 'active') client.lock(); });
    return () => { mounted.current = false; stop(); background.remove(); client.lock(); };
  }, [client]);

  const restore = async () => {
    setBusy(true);
    try {
      await client.restore();
      await client.open(personId);
      if (mounted.current) { setReady(true); setStatus('Original native SDK store restored.'); }
    } catch (error) { showError(error); } finally { if (mounted.current) setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      if (intent.current && intent.current.body !== draft) throw new Error('Recover the original uncertain send before changing its body.');
      if (!intent.current) intent.current = { id: 'native-matrix-' + Array.from(await Crypto.getRandomBytesAsync(16), b => b.toString(16).padStart(2, '0')).join(''), body: draft };
      await client.send(intent.current.id, intent.current.body);
      if (mounted.current) setStatus('Queued by the SDK, not delivered. Original intent retained.');
    } catch (error) { showError(error); } finally { if (mounted.current) setBusy(false); }
  };
  const file = async () => {
    setBusy(true);
    try {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const asset = !selected.canceled ? selected.assets[0] : undefined;
      if (!asset) return;
      const uri = await client.stageFile(asset.uri);
      const id = 'native-matrix-' + Array.from(await Crypto.getRandomBytesAsync(16), b => b.toString(16).padStart(2, '0')).join('');
      await client.file(id, uri, asset.mimeType ?? 'application/octet-stream', '');
      if (mounted.current) setStatus('SDK attachment operation returned. Not proof of delivery.');
    } catch (error) { showError(error); } finally { if (mounted.current) setBusy(false); }
  };
  const approve = () => {
    const review = sas;
    if (!review) return;
    Alert.alert('Compare both devices', 'Only confirm if every displayed emoji or number matches the other device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'They match', onPress: () => { void client.verification('approve', review.revision).catch(showError); } }
    ]);
  };
  return <View style={styles.root}>
    <View style={styles.header}><Text style={styles.title}>Private conversation</Text>
      <Pressable accessibilityRole="button" onPress={() => { client.lock(); onClose(); }}><Text style={styles.link}>Close</Text></Pressable></View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
    {!ready && <Pressable disabled={busy} onPress={() => { void restore(); }} style={styles.button}><Text>Restore original Matrix session</Text></Pressable>}
    <ScrollView style={styles.timeline}>{events.map((event, index) => <View key={event.eventId ?? event.transactionId ?? String(index)} style={styles.message}>
      <Text style={styles.sender}>{event.own ? 'You' : event.sender}</Text>
      <Text>{event.body ?? (event.kind === 'unable-to-decrypt' ? 'Waiting for the original encryption keys.' : event.kind)}</Text>
      <Text style={styles.status}>{event.remote ? 'SDK remote event' : 'SDK local echo, not delivered'}</Text>
    </View>)}</ScrollView>
    {ready && <>
      <TextInput accessibilityLabel="Message" multiline value={draft} onChangeText={setDraft} editable={!busy} style={styles.input} placeholder="Write a private message" />
      <View style={styles.actions}>
        <Pressable disabled={busy || !draft.trim()} onPress={() => Alert.alert('Send this message?', 'Send the reviewed message through the native Matrix SDK.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: () => { void send(); } }])}><Text style={styles.link}>Send</Text></Pressable>
        <Pressable disabled={busy} onPress={() => { void file(); }}><Text style={styles.link}>Choose image</Text></Pressable>
        <Pressable disabled={busy} onPress={() => { void client.requestVerification(personId).catch(showError); }}><Text style={styles.link}>Verify device</Text></Pressable>
      </View>
    </>}
    {sas && <View style={styles.verification}>
      <Text style={styles.title}>Compare on both devices</Text><Text>{sas.values.join('   ')}</Text>
      <View style={styles.actions}>
        <Pressable onPress={approve}><Text style={styles.link}>They match</Text></Pressable>
        <Pressable onPress={() => { void client.verification('reject', sas.revision).catch(showError); }}><Text style={styles.link}>Do not match</Text></Pressable>
        <Pressable onPress={() => { void client.verification('cancel', sas.revision).catch(showError); }}><Text style={styles.link}>Cancel</Text></Pressable>
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f8fb', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '600', color: '#17283b' },
  link: { color: '#1266b2', fontWeight: '600', paddingVertical: 12 },
  status: { color: '#53677d', fontSize: 12, marginVertical: 8 },
  button: { padding: 16, backgroundColor: '#e1edf7', borderRadius: 12, marginVertical: 12 },
  timeline: { flex: 1 }, message: { padding: 16, marginVertical: 6, borderRadius: 14, backgroundColor: '#fff' },
  sender: { color: '#53677d', fontSize: 12, marginBottom: 8 },
  input: { minHeight: 72, padding: 14, borderColor: '#cbd9e6', borderWidth: 1, borderRadius: 12, backgroundColor: '#fff' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 }, verification: { padding: 16, borderRadius: 14, backgroundColor: '#e1edf7' }
});
