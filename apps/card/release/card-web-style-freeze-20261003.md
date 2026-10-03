# Card Web direction and JSX rendering fix

Source: da0ac0efb33423dec6bad108446c83268e009bc9
Tree: 9a6b97207203829a40adb08daf6e2a66508ad26f
Parent: 0a3590714ca72beaa8a18884f4e49b9706dd9626
Branch: codex/card-test-service-recovery-20261002

The original Logo freeze is included. Web styles use writingDirection; Android/iOS keep direction. App header/support JSX no longer passes bare whitespace text to non-Text containers. Provider choice, approval, account, data and permission behavior are unchanged.

Tests: style contracts 10/10, Provider UI successor 19/19, typecheck PASS. Initial Provider run was 18/19 because its old Arabic fixture required the invalid Web property; original FAIL log remains. The new fixture asserts writingDirection=rtl and absence of direction without removing existing locale/error assertions. These are source/synthetic gates, not real approval or native install evidence.

Actual local Web: clean port 19088 default English, explicit Arabic and return to English, computed DOM direction rtl. Desktop 1440x1000 and mobile 390x844 screenshots/logs are retained. Observed errors=0, warnings=1 (existing shadow style deprecation), not all-console-zero. An unauthenticated Provider section still has English title/body/action in Arabic; complete localization remains open and is reported to Root rather than falsely promoted.

Evidence: apps/card/evidence/20261003-web-style/manifest.json
SHA-256: f1f36e5bc5f78de7be41ae4f1e490d770e91669a6e96dd723e4e121ac05911da

Only Root/A owns formal build, shared review/revoke transport and public deployment. Feed this successor frontend into the existing complete Card integration input. No account request, signature or transaction was issued. Public/installed/authenticated/ACTIVE/funding/real-card/PAN/CVV/fiat/payment completion remains false.
