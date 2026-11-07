//go:build unix

package consensus

import (
	"errors"

	"github.com/cometbft/cometbft/node"
)

func (c *ProofHostLiveControl) closeWalletPolicyProofChild() error      { return c.Close() }
func (c *PQLabLiveMaterialsControl) closeWalletPolicyProofChild() error { return c.Close() }

func (a *Application) attachWalletPolicyProofHost(n *node.Node, c *ProofHostLiveControl) error {
	if c == nil || c.node != n || c.app != a {
		return ErrPQWalletPolicyLiveRetired
	}
	return a.attachWalletPolicyProofChild(n, c)
}

func (a *Application) attachWalletPolicyProofLab(n *node.Node, c *PQLabLiveMaterialsControl) error {
	if c == nil || c.node != n || c.app != a {
		return ErrPQWalletPolicyLiveRetired
	}
	return a.attachWalletPolicyProofChild(n, c)
}

// Private fixed typed child composition, not an arbitrary callback registry.
// The two original constructors keep all their original policy/file checks.
// This replaces only their Node registration, which already belongs to the
// constructor-bound composite lifetime. There remains at most ONE proof child.
func (a *Application) attachWalletPolicyProofChild(n *node.Node, child pqWalletPolicyProofChild) error {
	s, err := a.WalletPolicyLiveSource()
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.node != n || s.retired || s.child != nil || n.IsRunning() {
		return errors.New("original proof child must attach once before owning Node startup")
	}
	switch c := child.(type) {
	case *ProofHostLiveControl:
		if c == nil || c.node != n || c.app != a {
			return ErrPQWalletPolicyLiveRetired
		}
	case *PQLabLiveMaterialsControl:
		if c == nil || c.node != n || c.app != a {
			return ErrPQWalletPolicyLiveRetired
		}
	default:
		return errors.New("only the original fixed proof controls can share this lifetime")
	}
	s.child = child
	return nil
}
