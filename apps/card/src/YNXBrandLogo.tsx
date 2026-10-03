import React from "react";
import {Image, StyleSheet} from "react-native";

// Original ecosystem artwork, byte-identical to the accepted Website asset.
// Keep this product brand separate from account avatars and wallet providers.
export function YNXBrandLogo() {
  return <Image source={require("../assets/ynx-logo.png")}
    accessibilityLabel="YNX" accessibilityRole="image" resizeMode="contain"
    style={styles.logo}/>;
}

const styles = StyleSheet.create({
  logo: {width: 45.6, height: 24, aspectRatio: 798 / 420, flexShrink: 0},
});
