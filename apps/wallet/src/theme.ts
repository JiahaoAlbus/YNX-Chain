export type WalletColors=Readonly<{blue:string;white:string;ink:string;muted:string;line:string;surface:string;danger:string;success:string;warning:string}>;

export const COLORS:WalletColors = Object.freeze({
  blue: "#002FA7", white: "#FFFFFF", ink: "#101828", muted: "#667085", line: "#E4E7EC",
  surface: "#F8FAFC", danger: "#B42318", success: "#067647", warning: "#B54708",
});

export const HIGH_CONTRAST_LIGHT:WalletColors = Object.freeze({
  blue: "#002FA7", white: "#FFFFFF", ink: "#000000", muted: "#344054", line: "#000000",
  surface: "#FFFFFF", danger: "#8A0000", success: "#005C39", warning: "#7A2E0E",
});
