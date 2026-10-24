package developerauthority

import (
	"context"
	"testing"
	"time"
)

// Only a PUBLIC fixture regression. The production verifier that rejected
// the original CI fixture is intentionally byte-identical to R217.
func TestR219PublicFixtureApprovalCannotOutliveAnyOriginalParent(t *testing.T) {
	at := time.Now().UnixMilli()
	for _, kind := range []string{"principal", "access", "publisher"} {
		t.Run(kind, func(t *testing.T) {
			p := Principal{Account: "PUBLIC", DeviceID: "PUBLIC", ExpiresMS: at + 28000}
			a := Access{ExpiresMS: at + 28000}
			k := Publisher{ExpiresMS: at + 26000}
			switch kind {
			case "principal":
				p.ExpiresMS = at + 1000
			case "access":
				a.ExpiresMS = at + 2000
			case "publisher":
				k.ExpiresMS = at + 3000
			}
			s := &r217PublicationSource{}
			v, e := s.VerifyOriginalArtifactApproval(context.Background(), p, a, k, ArtifactBinding{}, []byte("PUBLIC"), []byte("PUBLIC"), []byte("PUBLIC"), []byte("PUBLIC"), "PUBLIC")
			if e != nil || v.ExpiresMS > p.ExpiresMS || v.ExpiresMS > a.ExpiresMS || v.ExpiresMS > k.ExpiresMS || s.resource.ExpiresMS != v.ExpiresMS {
				t.Fatal("fixture moved outside original parent validity")
			}
		})
	}
}
