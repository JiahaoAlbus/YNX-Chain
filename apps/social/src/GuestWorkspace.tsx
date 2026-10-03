import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ContactRound, MessageCircle, Settings, Sparkles, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppearanceSettings, useSocialAppearance } from './SocialAppearance';
import { socialLayout } from './socialPresentation';
import { useI18n } from './i18nProvider';

const tabs = [
  { id: 'chats', label: 'Chats', icon: MessageCircle },
  { id: 'contacts', label: 'Contacts', icon: ContactRound },
  { id: 'moments', label: 'Moments', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;
type Tab = typeof tabs[number]['id'];
// This is the actual signed-out product surface, not a seeded conversation or
// substitute session. Only the explicit sign-in sheet mounts permission UI.
export function GuestWorkspace({ language, signIn, error, discoveryPending }: {
  language: React.ReactNode; signIn: React.ReactNode; error: string | null; discoveryPending: boolean;
}) {
  const { t, isRTL } = useI18n();
  const { scale } = useSocialAppearance();
  const { width } = useWindowDimensions();
  const desktop = socialLayout(width).desktop;
  const [tab, setTab] = useState<Tab>('chats');
  const [connect, setConnect] = useState(false);
  const current = tabs.find(item => item.id === tab)!;
  return <SafeAreaView style={[styles.root, { direction: isRTL ? 'rtl' : 'ltr' }]}>
    <View style={styles.header}><Image source={require('../assets/ynx-original-logo.png')} accessibilityLabel="Original YNX logo"
      resizeMode="contain" style={styles.logo} /><Text style={[styles.brand, { fontSize: 18 * scale }]}>YNX Social</Text>
      <Pressable accessibilityRole="button" onPress={() => setConnect(true)} style={styles.signIn}><Text style={{ color: '#002fa7', fontSize: 14 * scale }}>{t('Sign in')}</Text></Pressable></View>
    <View style={[styles.workspace, desktop && styles.desktop]}>
      <View style={[styles.content, desktop && tab === 'chats' && styles.chatList]}>
        <Text style={[styles.heading, { fontSize: 20 * scale }]}>{t(current.label)}</Text>
        {tab === 'settings' ? <ScrollView><AppearanceSettings /><View style={styles.language}>{language}</View>
          <Text style={[styles.note, { fontSize: 13 * scale }]}>{t('Social never creates, imports, or receives your recovery key.')}</Text></ScrollView> :
          <View style={styles.empty}><current.icon size={32} color="#002fa7" strokeWidth={1.5} />
            <Text style={[styles.emptyTitle, { fontSize: 18 * scale }]}>{t(tab === 'chats' ? 'Your conversations' : tab === 'contacts' ? 'People you choose' : 'Your moments')}</Text>
            <Text style={[styles.note, { fontSize: 14 * scale }]}>{t(tab === 'chats' ? 'Sign in to restore your conversations on this device.' : tab === 'contacts' ? 'Find people by username, QR or invitation. Requests and following stay separate.' : 'Sign in to see moments shared with you. Private audiences stay protected.')}</Text>
            <Pressable accessibilityRole="button" onPress={() => setConnect(true)} style={styles.primary}><Text style={{ color: '#fff', fontSize: 14 * scale }}>{t('Continue with YNX')}</Text></Pressable>
            {discoveryPending && <Text style={[styles.note, { fontSize: 13 * scale }]}>{t('A discovery link is waiting. Sign in to review the person before sending a request.')}</Text>}
          </View>}
      </View>
      {desktop && tab === 'chats' && <View style={styles.detail}><Image source={require('../assets/ynx-original-logo.png')} resizeMode="contain" style={{ width: 76, height: 40 }} />
        <Text style={[styles.emptyTitle, { fontSize: 20 * scale }]}>YNX Social</Text><Text style={[styles.note, { fontSize: 14 * scale }]}>{t('Private conversations, thoughtful moments, and people you choose.')}</Text></View>}
      <View style={[styles.navigation, desktop && styles.rail]}>{tabs.map(item => <Pressable key={item.id} accessibilityRole="tab"
        accessibilityState={{ selected: tab === item.id }} onPress={() => setTab(item.id)} style={[styles.tab, desktop && styles.railTab]}>
        <item.icon size={22} color={tab === item.id ? '#002fa7' : '#667085'} strokeWidth={tab === item.id ? 2.3 : 1.7} />
        <Text style={{ color: tab === item.id ? '#002fa7' : '#667085', fontSize: 11 * scale }}>{t(item.label)}</Text>
      </Pressable>)}</View>
    </View>
    <Modal visible={connect} transparent animationType="slide" onRequestClose={() => setConnect(false)}>
      <SafeAreaView style={styles.backdrop}><View style={styles.sheet}><View style={styles.sheetHeader}>
        <Text style={[styles.emptyTitle, { fontSize: 20 * scale }]}>{t('Sign in to YNX Social')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => setConnect(false)} style={styles.close}><X size={22} color="#14263b" /></Pressable>
      </View><ScrollView>{error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}{signIn}</ScrollView></View></SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, minHeight: 62, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e3e8ef' },
  logo: { width: 24 * 798 / 420, height: 24 }, brand: { flex: 1, color: '#14263b', fontWeight: '600' }, signIn: { padding: 12, minHeight: 48, justifyContent: 'center' },
  workspace: { flex: 1, minHeight: 0 }, desktop: { flexDirection: 'row', paddingStart: 100 }, content: { flex: 1, minWidth: 0 }, chatList: { flex: 0, width: 340, borderEndWidth: StyleSheet.hairlineWidth, borderEndColor: '#e3e8ef' },
  heading: { paddingHorizontal: 20, paddingVertical: 18, color: '#14263b', fontWeight: '600' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyTitle: { color: '#14263b', fontWeight: '600' }, note: { color: '#667085', textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 }, primary: { backgroundColor: '#002fa7', borderRadius: 24, minHeight: 48, paddingHorizontal: 22, justifyContent: 'center', marginTop: 10 },
  detail: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, backgroundColor: '#e9eff5' }, navigation: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e3e8ef', minHeight: 66 },
  rail: { position: 'absolute', start: 0, top: 0, bottom: 0, width: 100, flexDirection: 'column', borderTopWidth: 0, borderEndWidth: StyleSheet.hairlineWidth, borderEndColor: '#e3e8ef', paddingVertical: 12, gap: 8 }, tab: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 5 },
  railTab: { flex: 0, minHeight: 72 },
  language: { paddingHorizontal: 20, alignItems: 'flex-start', marginBottom: 20 }, backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,24,40,.4)' }, sheet: { alignSelf: 'center', width: '100%', maxWidth: 540, maxHeight: '90%', backgroundColor: '#fff', padding: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, close: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' }, error: { color: '#b42318', marginVertical: 12 },
});
