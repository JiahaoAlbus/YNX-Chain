import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MatrixMediaPreview } from './nativeMatrixMedia';
import { bindMediaPresentation, markMediaPresentationDecodeFailure, visibleMediaPresentation,
  type BoundMediaPresentation } from './nativeMediaPresentation';

const defaultTranslate = (text: string) => text;

type Props = Readonly<{
  preview: MatrixMediaPreview;
  roomId: string;
  eventId: string;
  onClose: () => void;
  onCleanupFailure: () => void;
  t?: (text: string) => string;
}>;

/** Explicit received-file UI. The production parent must use the admitted native
 * media port and current canonical/accepted-peer checks, not fixture callbacks.
 * Merely rendering this component does not open a file or request authorization.
 */
export function NativeMatrixMediaViewer({ preview, roomId, eventId, onClose, onCleanupFailure,
  t = defaultTranslate }: Props) {
  const [presentation, setPresentation] = useState<BoundMediaPresentation>();
  const scope = { preview, roomId, eventId };
  const lease = visibleMediaPresentation(scope, presentation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decodeError = presentation?.imageDecodeFailed === true;
  const epoch = useRef(0);
  const mounted = useRef(false);
  const translation = useRef(t);
  const cleanupFailure = useRef(onCleanupFailure);
  translation.current = t;
  cleanupFailure.current = onCleanupFailure;

  useEffect(() => {
    mounted.current = true; ++epoch.current;
    setPresentation(undefined); setError(''); setBusy(false);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') return;
      ++epoch.current; setPresentation(undefined); setBusy(false);
      setError(translation.current('Preview locked while the app is in the background.'));
      void preview.close().catch(() => { cleanupFailure.current(); });
    });
    return () => {
      mounted.current = false; ++epoch.current; subscription.remove();
      void preview.close().catch(() => { cleanupFailure.current(); });
    };
  }, [preview, roomId, eventId]);

  const open = async () => {
    if (busy) return;
    const attempt = ++epoch.current;
    setPresentation(undefined); setError(''); setBusy(true);
    try {
      const original = await preview.open(roomId, eventId);
      if (mounted.current && epoch.current === attempt) setPresentation(bindMediaPresentation(scope, original));
    } catch {
      if (mounted.current && epoch.current === attempt) {
        setError(t('This attachment could not be opened. Check your session and contact permission, then retry.'));
      }
    } finally {
      if (mounted.current && epoch.current === attempt) setBusy(false);
    }
  };

  const close = async () => {
    const attempt = ++epoch.current;
    setPresentation(undefined); setBusy(true);
    try {
      await preview.close();
      if (mounted.current && epoch.current === attempt) onClose();
    } catch {
      onCleanupFailure();
      if (mounted.current && epoch.current === attempt) {
        setError(t('The preview is hidden, but its temporary file could not be released. Retry closing.'));
      }
    } finally {
      if (mounted.current && epoch.current === attempt) setBusy(false);
    }
  };

  return <View style={styles.root}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>{t('Encrypted attachment')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close attachment preview')}
        style={styles.control} onPress={() => { void close(); }}><Text style={styles.action}>{t('Close')}</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>{t('Open the original attachment on this device. Closing removes the temporary preview; your original message is retained.')}</Text>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {busy ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.body}>{t('Checking original attachment...')}</Text></View> : null}
      {lease ? <View style={styles.preview}>
        <Text selectable style={styles.filename}>{lease.filename}</Text>
        <Text style={styles.body}>{lease.mimeType} - {(lease.bytes / 1024).toFixed(1)} KB</Text>
        {lease.imagePreview && !decodeError ? <Image source={{ uri: lease.uri }} resizeMode="contain"
          accessibilityLabel={t('Original received image')} style={styles.image}
          onError={() => { setPresentation(current => markMediaPresentationDecodeFailure(current, presentation)); }} /> :
          <Text style={styles.body}>{t(decodeError ? 'This image could not be displayed. Retry or close its temporary preview.' :
            'This file type has no inline preview. It will not be launched or shared automatically.')}</Text>}
      </View> : null}
      <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }}
        style={[styles.button, busy && styles.disabled]} onPress={() => { void open(); }}>
        <Text style={styles.action}>{t(lease || error ? 'Retry original attachment' : 'Open encrypted attachment')}</Text>
      </Pressable>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  title: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '600', color: '#172b43' },
  control: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, gap: 16 },
  body: { fontSize: 14, lineHeight: 21, color: '#53677d' },
  error: { fontSize: 14, lineHeight: 21, color: '#b42318' },
  filename: { fontSize: 16, lineHeight: 24, color: '#172b43', fontWeight: '600' },
  action: { fontSize: 15, fontWeight: '600', color: '#0839c7' },
  loading: { gap: 12, alignItems: 'center' },
  preview: { gap: 12 }, image: { width: '100%', height: 240 },
  button: { minHeight: 48, padding: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#edf2ff' },
  disabled: { opacity: 0.5 }
});
