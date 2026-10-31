package originalclient

import link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"

// Before any TLS dispatch, exact same original Node routes and POST profile.
func validateFormalOperations(d authorityCallerDocument, p link.FixedPeerProfile) error {
	for _, a := range d.Actions {
		id, local, wanted := d.EffectOperation, d.LocalEffectPath, "/internal/auth/task-grants/effect"
		if a == "query" {
			id, local, wanted = d.QueryOperation, d.LocalQueryPath, "/internal/auth/task-grants/effect-query"
		}
		if local != wanted {
			return ErrBinding
		}
		found := false
		for _, op := range p.Operations {
			if op.ID == id {
				if found || op.Method != "POST" || op.Path != wanted || op.MaxRequestBytes < 1 || op.MaxRequestBytes > 1048576 || op.MaxResponseBytes < 1 || op.MaxResponseBytes > 1048576 {
					return ErrBinding
				}
				found = true
			}
		}
		if !found {
			return ErrBinding
		}
	}
	return nil
}
