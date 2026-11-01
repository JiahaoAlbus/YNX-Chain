package ownednode

// Diagnostics describes only observations made by this local manager. Child
// output and an owned process handle never establish a node role, chain sync,
// consensus finality, publisher authority or permission to manage another PID.
type Diagnostics struct {
	Code            string          `json:"code"`
	Authority       bool            `json:"authority"`
	Logs            LogReadback     `json:"logs"`
	Synchronization Synchronization `json:"synchronization"`
	Recovery        Recovery        `json:"recovery"`
}
type Synchronization struct {
	Code                string               `json:"code"`
	LocalHeight         *string              `json:"localHeight"`
	TargetHeight        *string              `json:"targetHeight"`
	CatchingUp          *bool                `json:"catchingUp"`
	Source              *string              `json:"source"`
	UpdatedAt           *string              `json:"updatedAt"`
	ExpiresAt           *string              `json:"expiresAt"`
	RunID               *string              `json:"runId"`
	Generation          *string              `json:"generation"`
	NetworkIdentity     *SyncNetworkIdentity `json:"networkIdentity"`
	NetworkID32Observed bool                 `json:"networkId32Observed"`
	Authority           bool                 `json:"authority"`
	IsolatedFixture     bool                 `json:"isolatedFixture"`
}
type Recovery struct {
	Code                     string `json:"code"`
	AutoRestart              bool   `json:"autoRestart"`
	StoredPIDIsControlHandle bool   `json:"storedPIDIsControlHandle"`
	ProcessOwned             bool   `json:"processOwned"`
	PriorEffectUnknown       bool   `json:"priorEffectUnknown"`
}

func (m *Manager) diagnostics() Diagnostics {
	out := Diagnostics{Code: "LOCAL_OBSERVATION_ONLY", Synchronization: m.synchronization(), Recovery: Recovery{Code: "IDLE", ProcessOwned: m.process != nil}}
	if err := m.rootUnchanged(); err != nil {
		out.Code = "UNAVAILABLE"
		out.Logs = LogReadback{Code: "UNAVAILABLE", RunID: m.state.RunID}
		out.Recovery.Code = "RECONCILING"
		out.Recovery.PriorEffectUnknown = true
		return out
	}
	logs, err := m.readLogs(m.state.RunID)
	if err != nil {
		logs = LogReadback{Code: "UNAVAILABLE", RunID: m.state.RunID}
		out.Code = "UNAVAILABLE"
	}
	out.Logs = logs
	if m.process != nil {
		out.Recovery.Code = "OWNED_RUNNING"
	}
	if m.state.Stage == "reconcile_required" || m.state.Stage == "installing" || m.state.Stage == "starting" || m.state.Stage == "stopping" || err != nil {
		out.Recovery.Code = "RECONCILING"
		out.Recovery.PriorEffectUnknown = true
	}
	return out
}
