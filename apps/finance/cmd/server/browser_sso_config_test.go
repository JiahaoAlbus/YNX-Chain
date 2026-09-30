package main

import "testing"

func TestCentralBrowserSSOExplicitConfiguration(t *testing.T) {
	for _, input := range []string{"", "false", "true", "TRUE", "1", " true", "false "} {
		value, err := centralBrowserSSOEnabled(input)
		valid := input == "" || input == "false" || input == "true"
		if (err == nil) != valid || value != (input == "true") {
			t.Fatalf("unexpected configuration result for %q", input)
		}
	}
}
