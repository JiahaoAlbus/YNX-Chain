import React from 'react';
import {Image, StyleSheet} from 'react-native';

/** Brand mark for the existing account entry flow. */
export function DesktopWelcomeBrand({mode}: Readonly<{mode: 'light' | 'dark'}>) {
  return (
    <Image
      source={require('../../../assets/ynx-original-logo.png')}
      accessibilityLabel="YNX Social"
      resizeMode="contain"
      style={[desktopWelcomeStyles.logo, mode === 'dark' && {tintColor: '#5B85FF'}]}
    />
  );
}

export const desktopWelcomeStyles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 48,
  },
  logo: {width: 100, height: 53, alignSelf: 'center', marginBottom: 20},
  heading: {textAlign: 'center'},
  summary: {textAlign: 'center'},
});
