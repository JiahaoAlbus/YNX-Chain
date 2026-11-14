import {StyleSheet} from 'react-native';

export const desktopContactStyles = StyleSheet.create({
  content: {width: '100%', maxWidth: 600, alignSelf: 'center', paddingTop: 40},
  identity: {flexDirection: 'column', alignItems: 'center', gap: 10},
  identityText: {alignItems: 'center', gap: 2},
  avatar: {width: 88, height: 88, borderRadius: 44},
  messageButton: {minWidth: 132, alignSelf: 'center'},
});
