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
	Code         string  `json:"code"`
	LocalHeight  *string `json:"localHeight"`
	TargetHeight *string `json:"targetHeight"`
	CatchingUp   *bool   `json:"catchingUp"`
}
type Recovery struct {
	Code                     string `json:"code"`
	AutoRestart              bool   `json:"autoRestart"`
	StoredPIDIsControlHandle bool   `json:"storedPIDIsControlHandle"`
	ProcessOwned             bool   `json:"processOwned"`
	PriorEffectUnknown       bool   `json:"priorEffectUnknown"`
}

func (m *Manager) diagnostics() Diagnostics {
	out := Diagnostics{Code: "LOCAL_OBSERVATION_ONLY", Synchronization: Synchronization{Code: "NOT_SUPPLIED"}, Recovery: Recovery{Code: "IDLE", ProcessOwned: m.process != nil}}
	// No original ordinary-runtime sync endpoint, network identity or height
	// contract has been supplied. Logs, elapsed time and public RPC cannot fill it.
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
