import {StyleSheet} from 'react-native';

export const desktopChatStyles = StyleSheet.create({
  selectedConversation: {borderRadius: 8},
  unread: {minWidth: 20, minHeight: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5},
  unreadText: {color: '#FFFFFF', fontSize: 11, fontWeight: '600'},
});
