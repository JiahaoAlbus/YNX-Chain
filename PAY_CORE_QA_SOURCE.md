# Isolated Pay / Core QA candidate

This candidate is not a Chain release or a merchant authorization.

- Core baseline: `6916cf821b8b767e80826665d6558e8aff886caf`.
- Pay source: `b0deb6d847321dca975516538433e8f5ba6031ea`, including its existing nativehost attachment and the new operator configuration in this candidate.
- Cloud and LINK source: P06 preserved `pq-core-composition-multi-refund-r1`; Auth Source: `pq-core-composition-original-order-r1`; binary HTTP module and LINK C headers: the P06 preserved compositions. They are captured in this commit, not inferred to be a single original owner commit.
- `pay-qa.mod` is the independent QA module input. The original `go.mod` remains Core's; no Chain release uses this combination.
- Test-only Core fixture reuses the original committed BlockExecutor/cold-reopen helpers; the generated helper is adapted to reuse the tests already present in the Core baseline.
- Run the candidate only with original, independently supplied operator inputs. A valid transport policy is not business authorization. An unavailable Source remains unavailable.
- The build/CI candidate does not establish same-source application installation, registered Root/caller, merchant approval, transaction finality, or real-funds authorization.
