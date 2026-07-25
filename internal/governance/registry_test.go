package governance

import (
	"encoding/json"
	"testing"
	"time"
)

func TestEmbeddedRegistriesAreCompleteBoundedAndCrossReferenced(t *testing.T) {
	registries, err := LoadEmbeddedRegistries()
	if err != nil {
		t.Fatal(err)
	}
	if len(registries.Objects.Objects) != 34 || len(registries.Parameters.Parameters) != 32 || len(registries.Roles.Roles) != 12 {
		t.Fatalf("unexpected registry sizes: objects=%d parameters=%d roles=%d", len(registries.Objects.Objects), len(registries.Parameters.Parameters), len(registries.Roles.Roles))
	}
	if len(registries.Digest) != 64 {
		t.Fatalf("invalid registry digest %q", registries.Digest)
	}
	objects := map[string]GovernanceObjectDefinition{}
	for _, object := range registries.Objects.Objects {
		objects[object.ObjectID] = object
		if object.RequiredTimelock == "0s" || object.SourceCommit != registrySourceCommit || object.Release != registryRelease || len(object.Evidence) == 0 || object.AuditID == "" {
			t.Fatalf("unsafe object: %+v", object)
		}
	}
	for _, parameter := range registries.Parameters.Parameters {
		if _, ok := objects[parameter.ObjectID]; !ok {
			t.Fatalf("unknown parameter owner: %+v", parameter)
		}
		if parameter.AllowedRange.Minimum == nil || parameter.AllowedRange.Maximum == nil || *parameter.AllowedRange.Minimum >= *parameter.AllowedRange.Maximum || parameter.MaximumChangePerProposal <= 0 || parameter.MaximumChangePerWindow <= 0 {
			t.Fatalf("unsafe bounds: %+v", parameter)
		}
		var current int64
		if err = json.Unmarshal(parameter.CurrentValue, &current); err != nil || current < *parameter.AllowedRange.Minimum || current > *parameter.AllowedRange.Maximum {
			t.Fatalf("current value outside bounds: %+v err=%v", parameter, err)
		}
	}
	foundEmergencyCouncil := false
	for _, role := range registries.Roles.Roles {
		if role.RoleID != RoleEmergencyCouncil {
			continue
		}
		foundEmergencyCouncil = true
		forbidden := map[string]bool{}
		for _, action := range role.ForbiddenActions {
			forbidden[action] = true
		}
		if !forbidden["transfer_user_assets"] || !forbidden["treasury_spend"] || !forbidden["permanent_parameter_change"] || len(role.EmergencyPermissions) != 1 {
			t.Fatalf("unsafe emergency council definition: %+v", role)
		}
	}
	if !foundEmergencyCouncil {
		t.Fatal("emergency council role missing")
	}
}

func TestRegistryServiceReturnsImmutableCopies(t *testing.T) {
	service := testService(t)
	first := service.RegistrySet()
	first.Objects.Objects[0].Name = "tampered"
	first.Parameters.Parameters[0].Path = "/tampered"
	first.Roles.Roles[0].ForbiddenActions[0] = "tampered"
	second := service.RegistrySet()
	if second.Objects.Objects[0].Name == "tampered" || second.Parameters.Parameters[0].Path == "/tampered" || second.Roles.Roles[0].ForbiddenActions[0] == "tampered" {
		t.Fatal("registry clone isolation failed")
	}
	if _, err := time.Parse(time.RFC3339, second.Objects.Objects[0].EffectiveAt); err != nil {
		t.Fatalf("invalid effective time: %v", err)
	}
}
