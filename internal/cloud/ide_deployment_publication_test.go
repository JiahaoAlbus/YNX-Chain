package cloud

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// These PUBLIC mapping values have no Auth-private proof state and cannot
// pass the original Catalog.RecheckPermit. They test translation, not approval.
func TestIDEDeploymentPublicationMappingRetainsOriginalPrivatePermit(t *testing.T) {
	original := &developerauthority.PublicationPermit{RequestID: "PUBLIC_ORIGINAL_REQUEST", Principal: "PUBLIC_ACCOUNT", PublisherID: "PUBLIC_PUBLISHER", ResourceID: "PUBLIC_RESOURCE", ResourceApprovalRef: "PUBLIC_NOT_APPROVAL", ApprovalSHA256: strings.Repeat("a", 64), ManifestSHA256: strings.Repeat("b", 64), RuntimeSeconds: 30, ExpiresMS: time.Now().Add(time.Minute).UnixMilli(), Binding: developerauthority.ArtifactBinding{ProjectID: "PUBLIC_PROJECT", Version: "1", ContentDigest: strings.Repeat("c", 64), PublishPurpose: "deploy", TargetEnvironment: "PUBLIC_ENV", ByteSize: 19}}
	p := cloudPublicationPermit(original)
	if !sameOriginalPublicationPermit(p) || p.originalAuthPermit != original {
		t.Fatal("original Auth permit lost")
	}
	for _, mutate := range []func(*IDEDeploymentPermit){func(p *IDEDeploymentPermit) { p.RequestID = "OTHER" }, func(p *IDEDeploymentPermit) { p.Principal = "OTHER" }, func(p *IDEDeploymentPermit) { p.PublisherID = "OTHER" }, func(p *IDEDeploymentPermit) { p.ResourceID = "OTHER" }, func(p *IDEDeploymentPermit) { p.ResourceApprovalRef = "OTHER" }, func(p *IDEDeploymentPermit) { p.RuntimeSeconds++ }, func(p *IDEDeploymentPermit) { p.Binding.Version = "OTHER" }, func(p *IDEDeploymentPermit) { p.ApprovalSHA256 = "OTHER" }, func(p *IDEDeploymentPermit) { p.ManifestSHA256 = "OTHER" }, func(p *IDEDeploymentPermit) { p.ExpiresAt = p.ExpiresAt.Add(time.Second) }, func(p *IDEDeploymentPermit) { p.RequiresAdditionalCharge = true }, func(p *IDEDeploymentPermit) { p.originalAuthPermit = nil }} {
		changed := p
		mutate(&changed)
		if sameOriginalPublicationPermit(changed) {
			t.Fatal("publication selection widened")
		}
	}
	encoded, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "originalAuthPermit") || strings.Contains(string(encoded), "ExpiresMS") {
		t.Fatal("private Auth object exposed")
	}
}

func TestIDEDeploymentPublicationConstructorRefusesMissingOriginalCatalog(t *testing.T) {
	if _, err := NewAuthIDEDeploymentAuthority(nil); err == nil {
		t.Fatal("missing original Catalog admitted")
	}
}
