# Android Wallet Faucet installed E2E evidence

This evidence binds source commit `6be5fff58d547ecf1511bde7d8adb2cf85c15ccb` to a locally signed Android release candidate. It does not claim production signing, store publication, public download replacement, consensus finality, or iOS activation.

The installed app retained one Faucet request ID across transport uncertainty and restart. The owner observed two explicit admission dispatch attempts: the original request and one manual recovery dispatch with the identical request ID/body. No automatic admission POST retry occurred, no replacement request ID was created, and the public chain contains one Faucet transaction. The exact client-side dispatch count is owner-observed and `independentlyProven=false` because the authenticated SecureStore journal was not exported.

Public identities:

- Account: `ynx1gancyh4f23jstsumrxa96v2gfedaqdekzfygl3` / `0x4767825ea9546505c39b19ba5d31484e5bd03736`
- Receiver: `ynx18lm70rushpj2wvqwzl065s6x0av7zc45w52ucl` / `0x3ff7e78f90b864a7300e17dfaa43467f59e162b4`
- Faucet request: `wallet_c75d07b8dffa1d93cec501564335e662d6b0b83546ee15e63573ee41a9caaa77`
- Faucet transaction: `0x2390cde0c630c91716c76a3155636ae94351353dfe80573694e053cf3d1c044a`
- Transfer 1: `0x1e540118ac7d58488cf91213c4959b7e46c2fac0bd5cbb875371978b2ecbfcec`
- Transfer 2: `0xa07902864172298a9d42e8c7abfdc2b3f73159e4537e8f3b226d2cc07d61ce27`

Installed acceptance observed: Faucet 100 YNXT receipt checked and review saved; two 1 YNXT transfers with 1 YNXT fees; restart recovery of the second stored transaction; final balance 96 YNXT and nonce 2; offline read failure without losing the account; online recovery to the same balance and nonce. XML files are accessibility-tree evidence from the installed app. The screenshot contains public account state only.

The final locally signed candidate is versionCode 21, versionName `1.0.14-testnet-preview`. APK signing uses the Android Debug certificate and is only for local installed QA.
