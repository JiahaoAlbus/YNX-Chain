package consensus

import "fmt"

// validateAccountAbstractionPolicyState applies the same authority restrictions
// as live AA execution at each event's original execution height. An event is
// only an execution record: this check does not claim to recover or reverify the
// original owner/session signature from its hash.
func validateAccountAbstractionPolicyState(state CommittedState) error {
	for _, event := range state.UserOperationEvents {
		if event.BlockHeight <= 0 || event.BlockHeight > state.Height {
			return fmt.Errorf("committed user operation %s execution height %d is outside committed tip %d", event.ID, event.BlockHeight, state.Height)
		}
		authorities := []struct{ role, owner string }{
			{"account", event.Account},
			{"bundler", event.Bundler},
		}
		if event.PaymasterID != "" {
			index, exists := paymasterIndex(state.Paymasters, event.PaymasterID)
			if !exists {
				return fmt.Errorf("committed user operation %s paymaster is missing", event.ID)
			}
			// The sponsor is an immutable owner of the actual escrow. Do not
			// substitute an event-supplied payer for that authority.
			authorities = append(authorities, struct{ role, owner string }{"paymaster sponsor", state.Paymasters[index].Policy.Sponsor})
		}
		for _, authority := range authorities {
			if err := requireConsensusLegacy(state.AccountPolicy, authority.owner, event.BlockHeight); err != nil {
				return fmt.Errorf("committed user operation %s %s authorization at height %d: %w", event.ID, authority.role, event.BlockHeight, err)
			}
		}
	}
	return nil
}
