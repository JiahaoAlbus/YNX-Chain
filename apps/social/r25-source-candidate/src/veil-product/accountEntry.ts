/** Normal entry intent is navigation, never an account/device/history grant. */
export const accountEntryCases = ['newIdentityFirstDevice', 'existingIdentityAddDevice', 'restoreIdentity', 'revokedDeviceAttempt'] as const;
export type AccountEntryCase = typeof accountEntryCases[number];
export type AccountEntryRequirement = 'CREATE_IDENTITY_FIRST_DEVICE_API' | 'LOGIN_ADD_DEVICE_API' | 'RESTORE_AUTHORITY_API' | 'REVOKED_DEVICE_CHECK_API' | 'AUTHENTICATED_PRODUCT_SESSION' | 'AUTHORIZED_FRIEND_API' | 'JNI_NEW_SESSION_API' | 'BIDIRECTIONAL_MESSAGE_API' | 'RESTART_OFFLINE_STORE_API';
export type AccountEntryCapability = Readonly<{ intent: AccountEntryCase; availability: 'UNAVAILABLE'; requirements: readonly AccountEntryRequirement[]; grantsAccount: false; grantsHistory: false }>;
const downstream: readonly AccountEntryRequirement[] = Object.freeze(['AUTHENTICATED_PRODUCT_SESSION', 'AUTHORIZED_FRIEND_API', 'JNI_NEW_SESSION_API', 'BIDIRECTIONAL_MESSAGE_API', 'RESTART_OFFLINE_STORE_API']);
export const accountEntryCapabilities: readonly AccountEntryCapability[] = Object.freeze(accountEntryCases.map(intent => Object.freeze({
  intent, availability: 'UNAVAILABLE' as const, grantsAccount: false as const, grantsHistory: false as const,
  requirements: Object.freeze([({newIdentityFirstDevice:'CREATE_IDENTITY_FIRST_DEVICE_API',existingIdentityAddDevice:'LOGIN_ADD_DEVICE_API',restoreIdentity:'RESTORE_AUTHORITY_API',revokedDeviceAttempt:'REVOKED_DEVICE_CHECK_API'} as const)[intent], ...downstream]),
})));
export function selectAccountEntry(intent: AccountEntryCase): AccountEntryCapability {
  const entry=accountEntryCapabilities.find(value=>value.intent===intent);
  if(!entry) throw new Error('VEIL_ACCOUNT_ENTRY_INVALID');
  return entry;
}
