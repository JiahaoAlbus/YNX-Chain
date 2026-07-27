package trustproduct

import "sort"

const subjectExportSchemaVersion = "ynx-trust-subject-export/v1"

// SubjectExport is a privacy-bounded portability record. It deliberately omits
// central session bindings, token hashes, replay internals, the persistence
// integrity seal and records belonging only to other subjects.
type SubjectExport struct {
	SchemaVersion      string           `json:"schemaVersion"`
	Product            string           `json:"product"`
	StateFormatVersion int              `json:"stateFormatVersion"`
	GeneratedAt        string           `json:"generatedAt"`
	Account            string           `json:"account"`
	Cases              []Case           `json:"cases"`
	AI                 []AIRecord       `json:"ai"`
	Audit              []Audit          `json:"audit"`
	AuthorityAudit     []AuthorityAudit `json:"authorityAudit"`
	Policy             map[string]any   `json:"policy"`
}

func (s *Service) ExportSubject(a Actor) (SubjectExport, error) {
	if !validActor(a) {
		return SubjectExport{}, apiError{401, "authenticated Trust actor is required"}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	caseIDs := map[string]bool{}
	cases := make([]Case, 0)
	for _, c := range s.data.Cases {
		if c.Owner != a.ID && c.Subject != a.ID {
			continue
		}
		cases = append(cases, c)
		caseIDs[c.ID] = true
	}
	sort.Slice(cases, func(i, j int) bool {
		if cases[i].CreatedAt.Equal(cases[j].CreatedAt) {
			return cases[i].ID < cases[j].ID
		}
		return cases[i].CreatedAt.Before(cases[j].CreatedAt)
	})

	ai := make([]AIRecord, 0)
	aiIDs := map[string]bool{}
	for _, record := range s.data.AI {
		if record.Owner != a.ID || record.CaseID != "" && !caseIDs[record.CaseID] {
			continue
		}
		ai = append(ai, record)
		aiIDs[record.ID] = true
	}
	sort.Slice(ai, func(i, j int) bool {
		if ai[i].CreatedAt.Equal(ai[j].CreatedAt) {
			return ai[i].ID < ai[j].ID
		}
		return ai[i].CreatedAt.Before(ai[j].CreatedAt)
	})

	audit := make([]Audit, 0)
	for _, record := range s.data.Audit {
		if record.Actor == a.ID || caseIDs[record.Target] || aiIDs[record.Target] {
			audit = append(audit, record)
		}
	}
	sort.Slice(audit, func(i, j int) bool {
		if audit[i].At.Equal(audit[j].At) {
			return audit[i].ID < audit[j].ID
		}
		return audit[i].At.Before(audit[j].At)
	})

	authorityAudit := make([]AuthorityAudit, 0)
	for _, record := range s.data.AuthorityAudit {
		if record.Actor == a.ID {
			authorityAudit = append(authorityAudit, record)
		}
	}
	sort.Slice(authorityAudit, func(i, j int) bool {
		if authorityAudit[i].At.Equal(authorityAudit[j].At) {
			return authorityAudit[i].ID < authorityAudit[j].ID
		}
		return authorityAudit[i].At.Before(authorityAudit[j].At)
	})

	return SubjectExport{
		SchemaVersion:      subjectExportSchemaVersion,
		Product:            "ynx-trust-center",
		StateFormatVersion: currentSnapshotVersion,
		GeneratedAt:        s.cfg.Now().UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
		Account:            a.ID,
		Cases:              cases,
		AI:                 ai,
		Audit:              audit,
		AuthorityAudit:     authorityAudit,
		Policy: map[string]any{
			"scope":                  "records owned by or concerning the authenticated account",
			"centralSessionsOmitted": true,
			"replayInternalsOmitted": true,
			"persistenceSealOmitted": true,
			"otherSubjectsOmitted":   true,
		},
	}, nil
}
