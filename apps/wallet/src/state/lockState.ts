export type LockState = Readonly<{ locked: boolean; unlockedAccount: string | null; reason: "restart" | "user" | "background" | "account-switch" | "authorized" }>;
export type LockAction = {type:"unlock";account:string}|{type:"lock";reason:"user"|"background"}|{type:"switch";account:string};
export const initialLockState = (): LockState => Object.freeze({ locked: true, unlockedAccount: null, reason: "restart" });
export const isSelectedAccountUnlocked = (state:LockState,selectedAccount:string):boolean => !state.locked&&state.unlockedAccount===selectedAccount;
export function reduceLockState(state: LockState, action: LockAction): LockState {
  if (action.type === "unlock") return Object.freeze({ locked: false, unlockedAccount: action.account, reason: "authorized" });
  if (action.type === "lock") return Object.freeze({ locked: true, unlockedAccount: null, reason: action.reason });
  return Object.freeze({ locked: true, unlockedAccount: null, reason: "account-switch" });
}
