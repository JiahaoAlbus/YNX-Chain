import React from 'react';
import { Image, Platform, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';

// One persistent first-party brand surface, including guest, locked, setup,
// authenticated, and private-workspace screens. Provider/account avatars stay
// inside App and retain their distinct identities.
export function withSocialBrand(App: React.ComponentType) {
  return function SocialBrandRoot() {
    return <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Image source={require('../assets/ynx-original-logo.png')}
          accessibilityLabel="Original YNX logo" resizeMode="contain" style={styles.logo} />
        <Text style={styles.title}>YNX Social</Text>
      </View>
      <View style={styles.content}><App /></View>
    </SafeAreaView>;
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5ebf3' },
  logo: { width: 24 * 798 / 420, height: 24, flexShrink: 0 },
  title: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: '600', color: '#172b43' },
  content: { flex: 1, minHeight: 0 },
});
