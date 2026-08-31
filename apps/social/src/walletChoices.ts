export type SocialWalletChoiceId = "ynx-wallet" | "metamask";
export type SocialWalletChoice = Readonly<{
  id: SocialWalletChoiceId;
  name: "YNX Wallet" | "MetaMask";
  description: string;
  action: "sign-in" | "open-mobile";
  chainId: 6423;
  chainQuantity: "0x1917";
}>;

export const SOCIAL_WALLET_CHOICES: readonly SocialWalletChoice[] = Object.freeze([
  Object.freeze({
    id: "ynx-wallet",
    name: "YNX Wallet",
    description: "First-party Wallet authorization",
    action: "sign-in",
    chainId: 6423,
    chainQuantity: "0x1917",
  }),
  Object.freeze({
    id: "metamask",
    name: "MetaMask",
    description: "Official MetaMask Mobile DApp route",
    action: "open-mobile",
    chainId: 6423,
    chainQuantity: "0x1917",
  }),
]);

export function socialWalletChoice(id: SocialWalletChoiceId): SocialWalletChoice {
  const choice = SOCIAL_WALLET_CHOICES.find((item) => item.id === id);
  if (!choice) throw new Error("Unknown Social Wallet choice");
  return choice;
}
