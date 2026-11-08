# Same-owner close selection successor

Only a settled pending cleanup that has not selected the actual carrier close or Auth child close releases its private cached Promise. Concurrent callers share the in-flight Promise. Once an actual close is chosen, its UNKNOWN/error result remains immutable and is never retried. No continuation is re-opened or dispatched again.

The response is retained before interpreting its paired status. The paired original error is recorded before copying partial response DATA, so a later copying error cannot replace raw 0 or null. Response release remains once and physical LINK drain precedes Auth child cleanup.

The pending-join counterexample exercises the finite SDK lifecycle contract with a PUBLIC boundary carrier. It does not establish a real LINK false-to-true path, an online leak, or an authorization bypass. Root, Source, matching wholeAddon and real P08 business admission remain separate and unverified. No Native/Go tests or old control matrices run for this successor.
