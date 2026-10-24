# Direct fee-history JSON candidate rejected

The preceding CPU profile identified JSON encoding/state hashing as a dominant full-validation cost. This experiment encodes every original fee field in original order, uses an ASCII string path with standard JSON fallback for escaping/Unicode/invalidUTF8, and keeps standard time encoding. Non-fee fields are still encoded by the original JSON encoder. Every canonical byte is hashed; no fee history or validation is removed.

Exact bytes and SHA match json.Marshal across versions1..13 and the retained real1024 state, nil/empty histories, unusual strings/long fields/timezones, every single-byte string, and encoding errors. Sink-firstcause/shortwrite/framing/repeated-write and concurrent private-buffer tests pass under race. Tests and candidate source are retained together in the replayable patch; they were not removed to pass a failing correctness check.

The first variant allocated an additional large scratch buffer and showed no timing gain. The revised private scratch pool reduced that overhead, but same-binary/real-input ABBAAB100ms medians still give original779,908ns/76,987B/2055alloc versus candidate795,776ns/77,269B/2057alloc: about2.03% slower, with overlapping sample ranges. This does not justify changing the default or claiming an improvement. Short local samples are not Linux or network capacity evidence.

Decision: reject activation. The active state hash implementation remains unchanged. Preserve both prototype raw outputs, revised source/tests patch and exact machine evidence. Reapply the patch only for an explicitly selected follow-up experiment; do not silently enable it. The independently frozen c8b7 submit8/16 Hosted run40085358438 contains none of this experiment.
