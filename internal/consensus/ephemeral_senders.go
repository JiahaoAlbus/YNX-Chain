package consensus

// EphemeralSenderBundle is only generated on explicit opt-in by the isolated
// performance fixture. It is never a wallet import or production authority.
const EphemeralSenderFile = "ephemeral-sender-secrets.json"
const EphemeralSenderPurpose = "isolated-local-performance-senders-v1"

type EphemeralSenderBundle struct {
	Purpose            string                  `json:"purpose"`
	ManifestSHA256     string                  `json:"manifestSha256"`
	MigrationStateHash string                  `json:"migrationStateHash"`
	GenesisHash        string                  `json:"genesisHash"`
	Senders            []EphemeralSenderSecret `json:"senders"`
}

type EphemeralSenderSecret struct {
	Address    string `json:"address"`
	PrivateKey string `json:"privateKey"`
}
