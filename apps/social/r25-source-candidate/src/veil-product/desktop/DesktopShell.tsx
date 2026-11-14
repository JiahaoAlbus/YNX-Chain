import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {CircleDot, ContactRound, MessageCircle, UserRound} from 'lucide-react-native';

export type DesktopSection = 'chats' | 'friends' | 'moments' | 'settings';

type DesktopLabels = Readonly<Record<DesktopSection, string>>;

type DesktopShellProps = Readonly<{
  section: DesktopSection;
  labels: DesktopLabels;
  mode: 'light' | 'dark';
  onSelectSection: (section: DesktopSection) => void;
}>;

const sections = [
  {key: 'chats', Icon: MessageCircle},
  {key: 'friends', Icon: ContactRound},
  {key: 'moments', Icon: CircleDot},
  {key: 'settings', Icon: UserRound},
] as const;

/** The parent supplies the actual product content and navigation callbacks. */
export function DesktopRail({section, labels, mode, onSelectSection}: DesktopShellProps) {
  const dark = mode === 'dark';
  const palette = dark
    ? {background: '#101114', divider: '#30333A', muted: '#A4A4AD', selected: '#1C2A50', accent: '#5B85FF'}
    : {background: '#FFFFFF', divider: '#E3E5E8', muted: '#737780', selected: '#EEF2FF', accent: '#002FA7'};

  return (
    <View style={[styles.rail, {backgroundColor: palette.background, borderRightColor: palette.divider}]}>
        <Image
          source={require('../../../assets/ynx-original-logo.png')}
          style={[styles.logo, dark && {tintColor: palette.accent}]}
          resizeMode="contain"
          accessibilityLabel="YNX Social"
        />
        <View accessibilityRole="tablist" style={styles.navigation}>
          {sections.map(({key, Icon}) => {
            const selected = key === section;
            const color = selected ? palette.accent : palette.muted;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityLabel={labels[key]}
                accessibilityState={{selected}}
                onPress={() => onSelectSection(key)}
                style={[styles.tab, selected && {backgroundColor: palette.selected}]}
              >
                <Icon size={23} color={color} strokeWidth={1.8} />
                <Text numberOfLines={1} style={[styles.label, {color}]}>{labels[key]}</Text>
              </Pressable>
            );
          })}
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {width: 68, borderRightWidth: StyleSheet.hairlineWidth, alignItems: 'center', paddingTop: 14},
  logo: {width: 38, height: 25},
  navigation: {alignSelf: 'stretch', alignItems: 'center', gap: 7, paddingTop: 17},
  tab: {width: 56, minHeight: 53, borderRadius: 9, alignItems: 'center', justifyContent: 'center', gap: 3},
  label: {fontSize: 10, lineHeight: 13, maxWidth: 52, textAlign: 'center'},
});
