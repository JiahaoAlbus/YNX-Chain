package main

import "testing"

func TestRuntimeConsumerCLIRequiresIndependentPinsAndRetainsExplicitModes(t *testing.T) {
	valid := pqOptions{migration: "original-migration.json", state: "original-state.json", genesisHash: "independent-genesis", originalGenesisHash: "independent-native", migrationHash: "independent-migration", runtimePlan: "runtime-plan.json", runtimePlanHash: "independent-plan", recoveryFD: -1}
	if !valid.enabled() || !valid.runtimeOnly() || valid.validate() != nil {
		t.Fatal("complete runtime-only configuration rejected")
	}
	for _, mutate := range []func(*pqOptions){func(p *pqOptions) { p.runtimePlan = "" }, func(p *pqOptions) { p.runtimePlanHash = "" }, func(p *pqOptions) { p.genesisHash = "" }, func(p *pqOptions) { p.originalGenesisHash = "" }, func(p *pqOptions) { p.migrationHash = "" }, func(p *pqOptions) { p.migration = "" }, func(p *pqOptions) { p.state = "" }, func(p *pqOptions) { p.recoveryFD = 3 }, func(p *pqOptions) { p.vault = "unrelated.vault" }, func(p *pqOptions) { p.peerPin = "unrelated.pub" }} {
		bad := valid
		mutate(&bad)
		if bad.validate() == nil {
			t.Fatal("partial runtime configuration bypassed explicit custody/pins")
		}
	}
	pq := valid
	pq.schedule = "schedule.json"
	pq.scheduleHash = "independent-schedule"
	pq.binding = "binding.json"
	pq.vault = "existing.vault"
	pq.recoveryFD = 3
	if pq.runtimeOnly() || pq.validate() != nil {
		t.Fatal("explicit runtime plus PQ configuration lost independent PQ authority")
	}
	remote := pq
	remote.vault = ""
	remote.recoveryFD = -1
	remote.remoteAddress = "tcp://127.0.0.1:27701"
	remote.transportKey = "existing.transport"
	remote.peerPin = "full-peer.pub"
	if remote.runtimeOnly() || remote.validate() != nil {
		t.Fatal("remote mode cannot consume explicit runtime plan")
	}
	if (pqOptions{recoveryFD: -1}).enabled() {
		t.Fatal("stock command defaults changed")
	}
}
