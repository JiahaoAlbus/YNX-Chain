package music

// StateCompatibilityPolicy is the machine-readable persisted-state contract
// for operators and release tooling. It deliberately separates readable and
// writable schemas: the current binary may migrate verified legacy inputs, but
// it never rewrites current state back to an older schema.
type StateCompatibilityPolicy struct {
	PolicyVersion                string `json:"policyVersion"`
	CurrentSchemaVersion         int    `json:"currentSchemaVersion"`
	MinimumReadableSchemaVersion int    `json:"minimumReadableSchemaVersion"`
	MinimumWritableSchemaVersion int    `json:"minimumWritableSchemaVersion"`
	ReadableSchemaVersions       []int  `json:"readableSchemaVersions"`
	WritableSchemaVersions       []int  `json:"writableSchemaVersions"`
	AutoMigratedSchemaVersions   []int  `json:"autoMigratedSchemaVersions"`
	DowngradeSupported           bool   `json:"downgradeSupported"`
	RollbackStrategy             string `json:"rollbackStrategy"`
}

// StateCompatibility returns a fresh compatibility descriptor so callers
// cannot mutate package-level policy through returned slices.
func StateCompatibility() StateCompatibilityPolicy {
	return StateCompatibilityPolicy{
		PolicyVersion:                "1.0",
		CurrentSchemaVersion:         currentStateSchemaVersion,
		MinimumReadableSchemaVersion: 1,
		MinimumWritableSchemaVersion: currentStateSchemaVersion,
		ReadableSchemaVersions:       []int{1, 2, 3, 4, currentStateSchemaVersion},
		WritableSchemaVersions:       []int{currentStateSchemaVersion},
		AutoMigratedSchemaVersions:   []int{1, 2, 3, 4},
		DowngradeSupported:           false,
		RollbackStrategy:             "restore a verified pre-upgrade backup with the matching older binary; in-place schema downgrade is unsupported",
	}
}

func validStateCompatibility(p StateCompatibilityPolicy) bool {
	return p.CurrentSchemaVersion == currentStateSchemaVersion && validBackupStateCompatibility(p)
}

// Validate each original descriptor at its original version, including historic
// schema2/3 backups. Backup verification never rewrites that descriptor.
func validBackupStateCompatibility(p StateCompatibilityPolicy) bool {
	v := p.CurrentSchemaVersion
	if v < 2 || v > currentStateSchemaVersion || p.PolicyVersion != "1.0" || p.MinimumReadableSchemaVersion != 1 || p.MinimumWritableSchemaVersion != v || len(p.ReadableSchemaVersions) != v || len(p.WritableSchemaVersions) != 1 || p.WritableSchemaVersions[0] != v || len(p.AutoMigratedSchemaVersions) != v-1 || p.DowngradeSupported || p.RollbackStrategy == "" {
		return false
	}
	for i, n := range p.ReadableSchemaVersions {
		if n != i+1 {
			return false
		}
	}
	for i, n := range p.AutoMigratedSchemaVersions {
		if n != i+1 {
			return false
		}
	}
	return true
}
