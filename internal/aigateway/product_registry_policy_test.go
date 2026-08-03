package aigateway

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type registryConformanceFile struct {
	Products []struct {
		ID              string `json:"id"`
		AllowedContexts []struct {
			Type          string   `json:"type"`
			DataClasses   []string `json:"dataClasses"`
			MaxBytes      int64    `json:"maxBytes"`
			Approval      string   `json:"approval"`
			Authority     string   `json:"authority"`
			SourceOwner   string   `json:"sourceOwner"`
			MaxAgeSeconds int64    `json:"maxAgeSeconds"`
		} `json:"allowedContexts"`
	} `json:"products"`
}

func TestGatewayProductContextSnapshotMatchesCanonicalRegistry(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "aiproduct", "product-ai-registry.json"))
	if err != nil {
		t.Fatal(err)
	}
	var registry registryConformanceFile
	if err := json.Unmarshal(raw, &registry); err != nil {
		t.Fatal(err)
	}
	if len(registry.Products) != len(gatewayProductContextPolicies) {
		t.Fatalf("Gateway registry products=%d canonical=%d", len(gatewayProductContextPolicies), len(registry.Products))
	}
	seen := map[string]bool{}
	for _, product := range registry.Products {
		if seen[product.ID] {
			t.Fatalf("canonical registry duplicates product %s", product.ID)
		}
		seen[product.ID] = true
		gatewayContexts, ok := gatewayProductContextPolicies[product.ID]
		if !ok || len(gatewayContexts) != len(product.AllowedContexts) {
			t.Fatalf("Gateway contexts drifted for product %s", product.ID)
		}
		for _, context := range product.AllowedContexts {
			if len(context.DataClasses) != 1 {
				t.Fatalf("canonical product %s context %s must expose one data class to the Gateway", product.ID, context.Type)
			}
			actual, ok := gatewayContexts[context.Type]
			if !ok {
				t.Fatalf("Gateway is missing %s/%s", product.ID, context.Type)
			}
			expected := gatewayProductContextPolicy{
				DataClass: context.DataClasses[0], Authority: context.Authority, SourceOwner: context.SourceOwner,
				Approval: context.Approval, MaxBytes: context.MaxBytes, MaxAgeSeconds: context.MaxAgeSeconds,
			}
			if actual != expected {
				t.Fatalf("Gateway policy drift for %s/%s: actual=%+v expected=%+v", product.ID, context.Type, actual, expected)
			}
		}
	}
}

func TestGatewayProductContextPolicyRejectsUnknownAndMismatchedAuthority(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	valid := productContextReference{
		ProductID: "mail", ContextType: "selected_mail_messages", DataClass: "communications",
		ReferenceHashes: []string{fmt.Sprintf("%064x", 17)}, SizeBytes: 1024,
		PermissionGatewayID: "permission-17", SourceVersion: "mail.v1", AsOf: now,
		Authority: "user-selected", SourceOwner: "mail",
	}
	if !validProductContextReference(valid) {
		t.Fatal("canonical Gateway product context was rejected")
	}
	unknown := valid
	unknown.ProductID = "unknown-product"
	if validProductContextReference(unknown) {
		t.Fatal("Gateway accepted an unknown product")
	}
	unknown = valid
	unknown.ContextType = "unknown-context"
	if validProductContextReference(unknown) {
		t.Fatal("Gateway accepted an unknown context")
	}
	wrongAuthority := valid
	wrongAuthority.Authority = "ynx-authoritative"
	if validProductContextReference(wrongAuthority) {
		t.Fatal("Gateway accepted a mismatched authority")
	}
	wrongOwner := valid
	wrongOwner.SourceOwner = "other-product"
	if validProductContextReference(wrongOwner) {
		t.Fatal("Gateway accepted a mismatched source owner")
	}
	missingPermission := valid
	missingPermission.PermissionGatewayID = ""
	if validProductContextReference(missingPermission) {
		t.Fatal("Gateway accepted a private product context without a permission reference")
	}
}
