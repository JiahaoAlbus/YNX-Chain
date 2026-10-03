package social

func reportIntentDigest(account, key, targetType, targetID, category, detail string, evidence []string) string {
	return objectDigest(struct {
		Version                                              int
		Account, Key, TargetType, TargetID, Category, Detail string
		Evidence                                             []string
	}{2, account, key, targetType, targetID, category, detail, append([]string{}, evidence...)})
}

func originalReportMatches(record SocialReport, objectID, account, targetType, targetID, category, detail string, evidence []string) bool {
	if record.ID == "" || record.ID != objectID || record.Reporter != account || record.TargetType != targetType || record.TargetID != targetID || record.Category != category || record.Detail != detail || len(record.EvidenceHashes) != len(evidence) {
		return false
	}
	for i, hash := range evidence {
		if record.EvidenceHashes[i] != hash {
			return false
		}
	}
	return true
}

func copyReportResult(record SocialReport) SocialReport {
	record.EvidenceHashes = append([]string(nil), record.EvidenceHashes...)
	return record
}
