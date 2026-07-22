# YNX Pay UI design audit

## Information architecture and tokens

The payment review is the primary surface: merchant, amount, YNXT fee, Testnet,
expiry and invoice signature precede a single Wallet confirmation action.
Pending, failed, expired and committed are distinct states. Receipts use a
timeline and expose transaction/block/audit evidence; no colorful card wall or
generic dashboard template is used. Klein blue `#002FA7`, neutral surfaces and
red/green status colors are the bounded palette.

## Platform, accessibility and locale

The app uses native React Native controls, safe areas, semantic button/alert
roles, scalable text, light/dark system appearance, touch targets and no WebView.
All 12 catalogs have identical nonblank keys and authority-language tests;
Arabic sets RTL. Android and iOS Hermes exports pass. iOS Simulator compilation
is defined in `.github/workflows/ci.yml` because Xcode is unavailable locally.

## Evidence status

The production Android APK rendered the signed-out Pay screen during the
current attempt, but the emulator then showed a system ANR and later died with
`DeadSystemException`. `evidence/android/anr-emulator-failure.png` is explicitly
failure evidence. It is not a cold-launch pass. The required current light/dark,
390x844, tablet, Arabic RTL, large text, loading, empty, failure and committed
success screenshot matrix remains open until a stable emulator and deployed
Gateway are available.

Known visual limitation: real committed receipt capture cannot be produced
before central integration and the fresh Testnet payment.
