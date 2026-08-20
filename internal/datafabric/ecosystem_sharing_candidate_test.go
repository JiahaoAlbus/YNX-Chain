package datafabric

import (
	"encoding/json"
	"path/filepath"
	"runtime"
	"testing"
)

func TestEcosystemSharingCandidateRemainsUnactivatedAndPrivate(t *testing.T) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("candidate test source path unavailable")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(source), "..", "..", "schemas", "data-fabric"))
	document := readCandidateSchema(t, filepath.Join(root, "ecosystem-sharing-events-v1.candidate.schema.json"))
	if document.Status != "CANDIDATE" || document.Activation != "PROHIBITED_UNTIL_INTEGRATION_ACCEPTANCE" {
		t.Fatalf("candidate activation boundary changed: status=%q activation=%q", document.Status, document.Activation)
	}
	for _, required := range []string{"eventId", "eventType", "tenant", "ownerReference", "contentDigest", "dataReference", "permissionSummary", "version", "auditId"} {
		if !containsCandidateField(document.Required, required) {
			t.Fatalf("candidate omitted required field %q", required)
		}
	}
	for _, forbidden := range []string{"content", "message", "recipientList", "privateKey", "seed", "bearerToken", "accountId", "walletAddress"} {
		if _, exists := document.Properties[forbidden]; exists {
			t.Fatalf("candidate exposes forbidden field %q", forbidden)
		}
	}
	var eventType struct {
		Enum []string `json:"enum"`
	}
	if err := json.Unmarshal(document.Properties["eventType"], &eventType); err != nil {
		t.Fatalf("decode candidate event types: %v", err)
	}
	for _, requiredType := range []string{
		"media.asset.published", "media.asset.versioned", "media.asset.shared", "media.access.granted", "media.access.revoked", "media.asset.deleted",
		"creator.revenue.accrued", "creator.revenue.corrected", "calendar.event.created", "calendar.event.shared", "calendar.event.cancelled",
	} {
		if !containsCandidateField(eventType.Enum, requiredType) {
			t.Fatalf("candidate omitted event type %q", requiredType)
		}
	}
}
