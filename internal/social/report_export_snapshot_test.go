package social

import (
	"strings"
	"testing"
)

// Uses real Service methods with the existing controlled authority fixture.
// This does not constitute installed-user or public-runtime evidence.
func TestExportReportEvidenceCannotMutateStoredReport(t *testing.T) {
	for _, stage := range []string{"created", "appealed"} {
		t.Run(stage, func(t *testing.T) {
			s, actor, moment := reportEvidenceFixture(t)
			original := strings.Repeat("a", 64)
			record, _, err := s.CreateSocialReport(actor, "export-report-snapshot", "moment", moment.ID, "other", "Original evidence", []string{original})
			if err != nil {
				t.Fatal(err)
			}
			if stage == "appealed" {
				record, err = s.AppealSocialReport(actor, record.ID, "Original correction")
				if err != nil {
					t.Fatal(err)
				}
			}
			before := objectDigest(s.state)
			exported := s.Export(actor)
			if len(exported.Reports) != 1 || exported.Reports[0].ID != record.ID || len(exported.Reports[0].EvidenceHashes) != 1 || exported.Reports[0].EvidenceHashes[0] != original {
				t.Fatal("export did not preserve the original report and evidence")
			}
			exported.Reports[0].EvidenceHashes[0] = strings.Repeat("b", 64)
			if objectDigest(s.state) != before {
				t.Fatal("exported evidence aliases stored report state")
			}
			read, err := s.SocialReport(actor, record.ID)
			if err != nil || read.EvidenceHashes[0] != original || read.Appeal != record.Appeal {
				t.Fatalf("export mutation changed the original report: %v", err)
			}
			replayed, replay, err := s.CreateSocialReport(actor, "export-report-snapshot", "moment", moment.ID, "other", "Original evidence", []string{original})
			if err != nil || !replay || replayed.ID != record.ID || replayed.EvidenceHashes[0] != original {
				t.Fatalf("export mutation changed original-key replay: %v", err)
			}
			if again := s.Export(actor); len(again.Reports) != 1 || again.Reports[0].EvidenceHashes[0] != original {
				t.Fatal("fresh export did not retain the original evidence")
			}
			other := newFixture(t, 137)
			if foreign := s.Export(Session{Account: other.account}); len(foreign.Reports) != 0 {
				t.Fatal("export exposed another account's report")
			}
		})
	}
}
