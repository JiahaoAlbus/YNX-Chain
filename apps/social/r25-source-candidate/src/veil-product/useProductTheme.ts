import {useEffect, useSyncExternalStore} from 'react';
import {Platform, useColorScheme, useWindowDimensions} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {createAppearancePreferences, resolveAppearance} from './appearancePreferences';
import {createProductStyles, themeColors} from './theme';

const preferences = createAppearancePreferences({
  async read(key) {return Platform.OS === 'web' ? globalThis.localStorage.getItem(key) : SecureStore.getItemAsync(key);},
  async write(key, value) {
    if (Platform.OS === 'web') globalThis.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
});
const cache = new Map<string, ReturnType<typeof createProductStyles>>();
export function useProductTheme() {
  const snapshot = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  const system = useColorScheme();
  const {width} = useWindowDimensions();
  const mode = resolveAppearance(snapshot.preference, system);
  // Cache only the three layout classes, never a growing list of physical widths.
  const size = width < 768 ? 390 : width < 1081 ? 1024 : width < 1700 ? 1440 : 1920;
  const key = `${mode}:${size}`;
  let styles = cache.get(key);
  if (!styles) {styles = createProductStyles(mode, size); cache.set(key, styles);}
  useEffect(() => {void preferences.initialize();}, []);
  return {styles, colors: themeColors[mode], mode, ...snapshot, selectAppearance: preferences.select};
}
