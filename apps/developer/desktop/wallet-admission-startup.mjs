// The owner-approved supplier has not yet supplied a successor target bound to
// THIS running App. In particular the supplied 2e external provenance file must
// never stand in for the new receiver-integrated package. This boundary is not
// populated by an environment variable, workspace, public flag or user setting.
// See wallet-admission-handoff.md for the exact remaining source-owner contract.
export async function openBundledWalletAdmission() {
  return Object.freeze({ assertCurrent() {
    throw Object.assign(Error('Wallet service admission is not supplied.'), { code: 'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED' });
  } });
}
