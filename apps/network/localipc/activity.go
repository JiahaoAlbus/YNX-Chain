package localipc

// Activity is a bounded helper self-observation, not an authorization manifest.
// Counts are decimal strings so clients never round uint64 measurements.
type Activity struct {
	Version         string                `json:"version"`
	Authority       bool                  `json:"authority"`
	ProductionGrant bool                  `json:"productionGrant"`
	Node            NodeActivity          `json:"node"`
	Participation   ParticipationActivity `json:"participation"`
	Resource        ResourceActivity      `json:"resource"`
}
type NodeActivity struct {
	Code             string `json:"code"`
	Stage            string `json:"stage,omitempty"`
	Mode             string `json:"mode,omitempty"`
	ProcessOwned     bool   `json:"processOwned"`
	CapacityComplete bool   `json:"capacityComplete"`
	UsedBytes        string `json:"usedBytes,omitempty"`
	LimitBytes       string `json:"limitBytes,omitempty"`
	FreeBytes        string `json:"freeBytes,omitempty"`
}
type ParticipationActivity struct {
	Code                      string `json:"code"`
	Configured                bool   `json:"configured"`
	WalletPublisherConfigured bool   `json:"walletPublisherConfigured"`
	Stopped                   bool   `json:"stopped"`
	Entries                   string `json:"entries,omitempty"`
	UnknownEntries            string `json:"unknownEntries,omitempty"`
}
type ResourceActivity struct {
	Code              string `json:"code"`
	State             string `json:"state,omitempty"`
	ActiveWorkers     string `json:"activeWorkers,omitempty"`
	VerifiedJobs      string `json:"verifiedJobs,omitempty"`
	VerifiedBytes     string `json:"verifiedBytes,omitempty"`
	Rewards           string `json:"rewards"`
	ProductionEnabled bool   `json:"productionEnabled"`
}
