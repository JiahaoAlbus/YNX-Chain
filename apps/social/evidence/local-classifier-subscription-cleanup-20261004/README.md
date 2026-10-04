# Synchronous subscription cancellation cleanup

Original source snapshot: ef83bada99309665cc3d7be9973288510b82322c.

Two new unchanged tests were run against the frozen original Git worker module. Both check synchronous abort/failure inside subscribe, followed by a throwing returned unsubscribe handle. The original runner exited 1: replacement work was still allowed instead of rejecting as stopped. Full original output is preserved.

The successor catches that late cleanup failure, closes this classifier instance, and cancels any remaining pending work. It preserves the already-settled original cancellation/failure and does not dispatch content or try to restart an uncertain engine. Existing terminate/unsubscribe/timeout and result validation behavior is preserved.

The related worker/display batch passed 40 tests, followed by TypeScript checking and Android Hermes export, exit 0. Fixtures are controlled worker ports with ordinary bytes, not an actual model or native engine. No network, Wallet or publication operation occurred.

The Android bundle name is identical to the preceding result-boundary export (index-b0a13ee13e3d54caec9a8dedf9b8e6ba.hbc). Thus this export establishes no actual UI inclusion or runtime mounting of these standalone classifier modules. It is not an installed app, classifier admission/model evaluation, privacy proof, independent security review or full Social acceptance. Integration into real display consumers remains a separate required task. Temporary export paths are diagnostic build outputs, not durable release packages.
