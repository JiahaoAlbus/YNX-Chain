package main

import "testing"

func TestRuntimeConsumerExternalABCIRejectsPlanWithoutTrustedEngineChannel(t *testing.T) {
	if err := rejectExternalRuntimeUpgrade("", ""); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{{"plan.json", ""}, {"", "pin"}, {"plan.json", "pin"}} {
		if rejectExternalRuntimeUpgrade(pair[0], pair[1]) == nil {
			t.Fatal("standalone ABCI accepted unauthenticated upgrade channel")
		}
	}
}
