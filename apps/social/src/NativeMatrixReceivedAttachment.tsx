import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeMatrixConsumer } from './nativeMatrix';
import { NativeMatrixMediaViewer } from './NativeMatrixMediaViewer';
import { useI18n } from './i18nProvider';
import { captureReceivedAttachment, completeReceivedAttachment, receivedAttachmentInScope,
  type ReceivedAttachment } from './receivedAttachmentState';
import { ReceivedAttachmentCleanups } from './receivedAttachmentCleanup';

type AttachmentTarget = ReturnType<NativeMatrixConsumer['receivedMedia']>;
type OriginalAttachment = ReceivedAttachment<NativeMatrixConsumer, AttachmentTarget>;
// Own only captured cleanup obligations, not sessions or new download authority.
// Keeping this outside the row preserves failures when a row/modal is unmounted.
const retainedCleanups = new ReceivedAttachmentCleanups<OriginalAttachment>();

// Only the actual SDK event row supplies an original remote event ID. Creating
// this view never grants a session or downloads; the viewer requires a tap.
export function NativeMatrixReceivedAttachment({ client, eventId }: { client: NativeMatrixConsumer; eventId: string }) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<ReceivedAttachment<NativeMatrixConsumer, AttachmentTarget>>();
  const originalSelection = receivedAttachmentInScope(selection, client, eventId);
  const target = originalSelection?.target;
  const pendingCleanup = useSyncExternalStore(retainedCleanups.subscribe, retainedCleanups.snapshot, retainedCleanups.snapshot);
  const [error, setError] = useState('');
  useEffect(() => {
    if (selection && !originalSelection) {
      // Rendering has already hidden/unmounted the stale viewer; its existing
      // cleanup owns the original lease. Do not close a replacement generation.
      setSelection(current => completeReceivedAttachment(current, selection));
    }
  }, [selection, originalSelection]);
  return <View>
    <Pressable accessibilityRole="button" disabled={pendingCleanup.length > 0} accessibilityLabel={t('Review received attachment')} style={styles.open}
      onPress={() => {
        setError('');
        try { setSelection(captureReceivedAttachment(client, eventId, client.receivedMedia(eventId))); }
        catch { setError(t('This attachment needs a current native session and supported build.')); }
      }}><Text style={styles.link}>{t('Review received attachment')}</Text></Pressable>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {pendingCleanup.length > 0 && <Pressable accessibilityRole="button" style={styles.open} onPress={() => {
      void retainedCleanups.retry().then(() => {
        if (retainedCleanups.snapshot().length === 0) setError('');
      }).catch(() => setError(t('Cleanup is pending. Retry closing the preview.')));
    }}><Text style={styles.link}>{t('Retry preview cleanup')}</Text></Pressable>}
    <Modal visible={Boolean(target)} animationType="slide" onRequestClose={() => {
      if (!originalSelection) return;
      const original = retainedCleanups.retain(originalSelection);
      setSelection(current => completeReceivedAttachment(current, originalSelection));
      void retainedCleanups.close(original).catch(() => setError(t('Cleanup is pending. Retry closing the preview.')));
    }}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}><Image source={require('../assets/ynx-original-logo.png')}
          resizeMode="contain" accessibilityLabel="Original YNX logo" style={styles.logo} /><Text style={styles.title}>YNX Social</Text></View>
        {originalSelection && <NativeMatrixMediaViewer preview={originalSelection.target.preview}
          roomId={originalSelection.target.roomId} eventId={originalSelection.eventId} t={t}
          onClose={() => {
            setSelection(current => completeReceivedAttachment(current, originalSelection));
          }} onCleanupStart={() => {
            const original = retainedCleanups.retain(originalSelection);
            return () => retainedCleanups.complete(original);
          }} onCleanupFailure={() => {
            retainedCleanups.retain(originalSelection); setError(t('Cleanup is pending. Retry closing the preview.'));
          }} />}
      </SafeAreaView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  open: { minHeight: 48, justifyContent: 'center' }, link: { color: '#002fa7', fontSize: 14 },
  error: { color: '#b42318', fontSize: 13, marginVertical: 8 }, root: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  logo: { width: 24 * 798 / 420, height: 24 }, title: { fontSize: 16, color: '#14263b', fontWeight: '600' },
});
