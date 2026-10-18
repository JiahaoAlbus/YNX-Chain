package consensus

import (
	"encoding/hex"
	"errors"
	"path/filepath"
)

// The control is preconfigured in the independently pinned operator plan.
// A later request can only stop this process at a future committed height;
// it cannot authorize a profile, replace the registry or change a signer.
func validateProductionOperatorHeightHalt(plan *ProductionOperatorPlan, role ProductionOperatorRole) error {
	if plan.HeightHaltSessionID == "" {
		if role.HeightHaltControlPath != "" {
			return errors.New("height halt requires its complete independently pinned operator session")
		}
		return nil
	}
	decoded, err := hex.DecodeString(plan.HeightHaltSessionID)
	if err != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != plan.HeightHaltSessionID || plan.HeightHaltSessionID == "0000000000000000000000000000000000000000000000000000000000000000" {
		return errors.New("operator height halt requires a nonzero canonical 32-byte session identity")
	}
	expected := filepath.Join(filepath.Dir(role.ABCIState), "operator-height-halt-"+plan.HeightHaltSessionID+".json")
	if role.HeightHaltControlPath != expected || !safeProductionOperatorPath(role.HeightHaltControlPath) {
		return errors.New("height halt must use the exact session path under this original application directory")
	}
	for _, path := range []string{role.ABCIState, role.LegacyKeyPath, role.LegacyStatePath, role.NodeKeyPath, role.TransportKeyPath} {
		if role.HeightHaltControlPath == path {
			return errors.New("height halt control cannot replace original state or custody")
		}
	}
	return nil
}
