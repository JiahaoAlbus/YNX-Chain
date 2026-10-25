package main

import (
	"encoding/hex"
	"errors"
	"strings"

	coretypes "github.com/cometbft/cometbft/rpc/core/types"
)

// The journal's complete bytes can be visible before a failed/unacknowledged
// write finishes. Only the application's post-Sync committed view corroborates
// live durability. This local RPC check is not a cryptographic execution proof.
func verifyJournalPublishedState(state durableEvidence, info *coretypes.ResultABCIInfo) error {
	if info == nil || info.Response.LastBlockHeight < state.Height {
		return errDurableNotReady
	}
	if len(info.Response.LastBlockAppHash) != 32 {
		return errors.New("published committed AppHash malformed")
	}
	if info.Response.LastBlockHeight == state.Height && !strings.EqualFold(hex.EncodeToString(info.Response.LastBlockAppHash), state.AppHash) {
		return errors.New("published committed AppHash differs from journal state")
	}
	return nil
}

func isJournalLayout(layout string) bool {
	return layout == "snapshot-journal" || layout == "block-journal"
}
