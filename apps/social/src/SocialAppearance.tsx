import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { appearanceScales, checkedAppearanceScale, type AppearanceScale } from './socialPresentation';
import { useI18n } from './i18nProvider';

const key = 'ynx.social.appearance.text-scale.v1';
const Context = createContext<{ scale: AppearanceScale; setScale: (value: AppearanceScale) => Promise<void> }>({ scale: 1, setScale: async () => {} });
export function SocialAppearanceProvider({ children }: { children: React.ReactNode }) {
  const [scale, update] = useState<AppearanceScale>(1);
  const revision = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let alive = true;
    const current = revision.current;
    void SecureStore.getItemAsync(key).then(value => {
      if (alive && current === revision.current) update(checkedAppearanceScale(value));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const setScale = (value: AppearanceScale) => {
    revision.current++;
    update(value);
    const write = writes.current.catch(() => {}).then(() => SecureStore.setItemAsync(key, String(value)));
    writes.current = write;
    return write;
  };
  return <Context.Provider value={{ scale, setScale }}>{children}</Context.Provider>;
}
export function useSocialAppearance() { return useContext(Context); }
export function AppearanceSettings() {
  const { scale, setScale } = useSocialAppearance();
  const { t } = useI18n();
  const [error, setError] = useState(false);
  return <View style={styles.card}>
    <Text style={[styles.title, { fontSize: 16 * scale }]}>{t('Text size')}</Text>
    <Text style={[styles.help, { fontSize: 13 * scale }]}>{t('Your system text size remains enabled.')}</Text>
    <View style={styles.options}>{appearanceScales.map(value => <Pressable key={value}
      accessibilityRole="radio" accessibilityState={{ checked: scale === value }}
      accessibilityLabel={t('Text size') + ' ' + Math.round(value * 100) + '%'}
      onPress={() => { setError(false); void setScale(value).catch(() => setError(true)); }}
      style={[styles.option, value === scale && styles.selected]}>
      <Text style={{ fontSize: 14 * scale, color: value === scale ? '#002fa7' : '#526579' }}>{Math.round(value * 100)}%</Text>
    </Pressable>)}</View>
    {error && <Text accessibilityRole="alert" style={styles.help}>{t('Text size changed for now. Tap again to retry saving.')}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 20, gap: 8 }, title: { color: '#14263b', fontWeight: '600' }, help: { color: '#667085', lineHeight: 20 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 48, minWidth: 58, padding: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f2f5f9' },
  selected: { backgroundColor: '#e7eeff', borderWidth: 1, borderColor: '#002fa7' },
});
