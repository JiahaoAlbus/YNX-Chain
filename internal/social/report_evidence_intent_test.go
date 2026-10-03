package social

import (
	"bytes"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// Actual Social business methods; the established current authority is synthetic.
func TestOriginalReportKeyCannotAcceptChangedEvidence(t *testing.T) {
	f := newFixture(t, 112)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	moment, _, err := s.CreateMoment(actor, "report-evidence-moment", "Original", "private", nil)
	if err != nil {
		t.Fatal(err)
	}
	original := []string{strings.Repeat("a", 64)}
	_, replay, err := s.CreateSocialReport(actor, "original-evidence-key", "moment", moment.ID, "spam", "Original report", original)
	if err != nil || replay {
		t.Fatalf("first report: replay=%v err=%v", replay, err)
	}
	before := objectDigest(s.state)
	_, _, err = s.CreateSocialReport(actor, "original-evidence-key", "moment", moment.ID, "spam", "Original report", []string{strings.Repeat("b", 64)})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("changed evidence was accepted under original key: %v", err)
	}
	if objectDigest(s.state) != before {
		t.Fatal("conflicting retry changed original state")
	}
}

func reportEvidenceFixture(t *testing.T) (*Service, Session, Moment) {
	t.Helper()
	f := newFixture(t, 113)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	moment, _, err := s.CreateMoment(actor, "report-fixture-moment", "Original", "private", nil)
	if err != nil {
		t.Fatal(err)
	}
	return s, actor, moment
}

func TestReportEvidenceSnapshotAndResultCopies(t *testing.T) {
	s, actor, moment := reportEvidenceFixture(t)
	original := strings.Repeat("a", 64)
	evidence := []string{original}
	actor.revalidateProduct = func(string) error { evidence[0] = "mutated-after-validation"; return nil }
	record, _, err := s.CreateSocialReport(actor, "snapshot-report-key", "moment", moment.ID, "spam", "Original report", evidence)
	if err != nil {
		t.Fatal(err)
	}
	if len(record.EvidenceHashes) != 1 || record.EvidenceHashes[0] != original {
		t.Fatal("revalidation borrowed mutable evidence")
	}
	record.EvidenceHashes[0] = strings.Repeat("b", 64)
	read, err := s.SocialReport(actor, record.ID)
	if err != nil || read.EvidenceHashes[0] != original {
		t.Fatalf("new result aliases stored report: %v", err)
	}
	read.EvidenceHashes[0] = strings.Repeat("c", 64)
	replayed, replay, err := s.CreateSocialReport(actor, "snapshot-report-key", "moment", moment.ID, "spam", "Original report", []string{original})
	if err != nil || !replay || replayed.EvidenceHashes[0] != original {
		t.Fatalf("read result aliases stored report: %v", err)
	}
	replayed.EvidenceHashes[0] = strings.Repeat("d", 64)
	if s.state.Reports[record.ID].EvidenceHashes[0] != original {
		t.Fatal("replayed result aliases stored report")
	}
}

func TestReportDistinctKeysDoNotOverwriteOriginalResult(t *testing.T) {
	s, actor, moment := reportEvidenceFixture(t)
	evidence := []string{strings.Repeat("a", 64)}
	first, _, err := s.CreateSocialReport(actor, "first-report-key", "moment", moment.ID, "spam", "Original report", evidence)
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := s.CreateSocialReport(actor, "second-report-key", "moment", moment.ID, "spam", "Original report", evidence)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID || len(s.state.Reports) != 2 {
		t.Fatal("distinct original operations share overwriteable result")
	}
	got, replay, err := s.CreateSocialReport(actor, "first-report-key", "moment", moment.ID, "spam", "Original report", evidence)
	if err != nil || !replay || got.ID != first.ID {
		t.Fatalf("original result replaced: %v", err)
	}
}

func TestLegacyOriginalReportColdReplayRetainsIdentityAndEvidence(t *testing.T) {
	s, actor, moment := reportEvidenceFixture(t)
	evidence := []string{strings.Repeat("a", 64)}
	record, _, err := s.CreateSocialReport(actor, "legacy-report-key", "moment", moment.ID, "spam", "Original report", evidence)
	if err != nil {
		t.Fatal(err)
	}
	legacyDigest := objectDigest(struct{ T, I, C, D, A string }{"moment", moment.ID, "spam", "Original report", actor.Account})
	delete(s.state.Reports, record.ID)
	record.ID = "report_" + legacyDigest[:24]
	s.state.Reports[record.ID] = record
	s.state.Idempotency[idempotencyStateKey(actor.Account, "legacy-report-key")] = idempotencyRecord{Action: "social_report", Digest: legacyDigest, ObjectID: record.ID}
	path, key := filepath.Join(t.TempDir(), "legacy-state.json"), bytes.Repeat([]byte{33}, 32)
	if err := saveState(path, &s.state, key); err != nil {
		t.Fatal(err)
	}
	cold, exists, err := loadState(path, key)
	if err != nil || !exists {
		t.Fatalf("cold legacy read: %v", err)
	}
	s.state = cold
	before := objectDigest(s.state)
	got, replay, err := s.CreateSocialReport(actor, "legacy-report-key", "moment", moment.ID, "spam", "Original report", evidence)
	if err != nil || !replay || got.ID != record.ID {
		t.Fatalf("legacy original denied/rebound: %v", err)
	}
	if objectDigest(s.state) != before {
		t.Fatal("legacy receipt migrated or rewritten")
	}
	if _, _, err := s.CreateSocialReport(actor, "legacy-report-key", "moment", moment.ID, "spam", "Original report", []string{strings.Repeat("b", 64)}); !errors.Is(err, ErrConflict) {
		t.Fatalf("legacy evidence replaced: %v", err)
	}
	actor.revalidateProduct = func(string) error { return ErrUnauthorized }
	if _, _, err := s.CreateSocialReport(actor, "legacy-report-key", "moment", moment.ID, "spam", "Original report", evidence); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("legacy replay bypassed current actor: %v", err)
	}
}
