// Package ynxconsensusauth contains a candidate consensus authentication codec
// and height policy. The v2 signing profile binds the full genesis identity;
// v1 key-registration records retain their separate immutable wire format.
// It is deliberately not wired into CometBFT yet.
//
// This protocol is separate from YNX-BATCH/v0.1. Every proposal, prevote and
// precommit is authorized individually, after its exact content is known.
// No code here implements a cryptographic primitive or assumes a missing
// provider, registry, historical verifier, or activation policy is acceptable.
package ynxconsensusauth
