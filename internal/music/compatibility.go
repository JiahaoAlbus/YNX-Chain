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
		ReadableSchemaVersions:       []int{1, currentStateSchemaVersion},
		WritableSchemaVersions:       []int{currentStateSchemaVersion},
		AutoMigratedSchemaVersions:   []int{1},
		DowngradeSupported:           false,
		RollbackStrategy:             "restore a verified pre-upgrade backup with the matching older binary; in-place schema downgrade is unsupported",
	}
}

func validStateCompatibility(policy StateCompatibilityPolicy) bool {
	return policy.PolicyVersion == "1.0" &&
		policy.CurrentSchemaVersion == currentStateSchemaVersion &&
		policy.MinimumReadableSchemaVersion == 1 &&
		policy.MinimumWritableSchemaVersion == currentStateSchemaVersion &&
		len(policy.ReadableSchemaVersions) == 2 &&
		policy.ReadableSchemaVersions[0] == 1 &&
		policy.ReadableSchemaVersions[1] == currentStateSchemaVersion &&
		len(policy.WritableSchemaVersions) == 1 &&
		policy.WritableSchemaVersions[0] == currentStateSchemaVersion &&
		len(policy.AutoMigratedSchemaVersions) == 1 &&
		policy.AutoMigratedSchemaVersions[0] == 1 &&
		!policy.DowngradeSupported &&
		policy.RollbackStrategy != ""
}
