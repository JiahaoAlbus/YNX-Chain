package types

import "github.com/cometbft/cometbft/crypto/ynxpq"

// CommitForFullKeyOverlap excludes a stable-address PQ key rotation from the
// old set's overlap tally. The current commit must still independently pass
// verification against the full current set. No signature is converted into
// old-key voting power, and the trusted denominator remains unchanged.
func CommitForFullKeyOverlap(trusted, current *ValidatorSet, commit *Commit) *Commit {
	if trusted == nil || current == nil || commit == nil {
		return commit
	}
	var filtered *Commit
	for i, sig := range commit.Signatures {
		if sig.BlockIDFlag == BlockIDFlagAbsent {
			continue
		}
		_, old := trusted.GetByAddress(sig.ValidatorAddress)
		_, next := current.GetByAddress(sig.ValidatorAddress)
		if old == nil || next == nil || old.PubKey == nil || next.PubKey == nil ||
			(old.PubKey.Type() != ynxpq.KeyType && next.PubKey.Type() != ynxpq.KeyType) || old.PubKey.Equals(next.PubKey) {
			continue
		}
		if filtered == nil {
			copy := *commit
			copy.hash = nil
			copy.Signatures = append([]CommitSig(nil), commit.Signatures...)
			filtered = &copy
		}
		filtered.Signatures[i] = NewCommitSigAbsent()
	}
	if filtered != nil {
		return filtered
	}
	return commit
}
