package consensus

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionOperatorHeightHaltNormalPackageBindsSessionAndPlan(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	f.plan.HeightHaltSessionID = strings.Repeat("a", 64)
	for i := range f.plan.Roles {
		r := &f.plan.Roles[i]
		r.HeightHaltControlPath = filepath.Join(filepath.Dir(r.ABCIState), "operator-height-halt-"+f.plan.HeightHaltSessionID+".json")
	}
	raw, pin := productionOperatorPlanBytes(t, f.plan)
	root := filepath.Join(t.TempDir(), "candidate")
	if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, raw, pin); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionOperatorCandidatePackage(root, pin); err != nil {
		t.Fatal(err)
	}
	for _, r := range f.plan.Roles {
		launch, err := os.ReadFile(filepath.Join(root, "roles", r.Role, "scripts/start-operator.sh"))
		if err != nil {
			t.Fatal(err)
		}
		for _, expected := range []string{"'--height-halt-control' '" + r.HeightHaltControlPath + "'", "'--operator-plan-sha256' '" + pin + "'", "'--height-halt-session-id' '" + f.plan.HeightHaltSessionID + "'"} {
			if !bytes.Contains(launch, []byte(expected)) {
				t.Fatal("normal pinned launcher lost halt scope", r.Role, expected)
			}
		}
		unit, err := os.ReadFile(filepath.Join(root, "roles", r.Role, "systemd/ynx-consensus-operator-candidate.service"))
		if err != nil || !bytes.Contains(unit, []byte("Restart=no\n")) {
			t.Fatal("halt can automatically restart the stopped original writer", err)
		}
	}
	for _, name := range []string{"missing-control", "missing-session", "uppercase-session", "zero-session", "original-state-alias", "foreign-directory"} {
		t.Run(name, func(t *testing.T) {
			plan := f.plan
			plan.Roles = append([]ProductionOperatorRole(nil), f.plan.Roles...)
			switch name {
			case "missing-control":
				plan.Roles[0].HeightHaltControlPath = ""
			case "missing-session":
				plan.HeightHaltSessionID = ""
			case "uppercase-session":
				plan.HeightHaltSessionID = strings.ToUpper(plan.HeightHaltSessionID)
			case "zero-session":
				plan.HeightHaltSessionID = strings.Repeat("0", 64)
			case "original-state-alias":
				plan.Roles[0].HeightHaltControlPath = plan.Roles[0].ABCIState
			case "foreign-directory":
				plan.Roles[0].HeightHaltControlPath = "/other/halt.json"
			}
			raw, pin := productionOperatorPlanBytes(t, plan)
			destination := filepath.Join(t.TempDir(), "rejected")
			if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, destination, f.genesisTime, raw, pin); err == nil {
				t.Fatal("incomplete halt control published in operator package", name)
			}
		})
	}
}
