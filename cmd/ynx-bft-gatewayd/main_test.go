package main

import "testing"

func TestEnvBool(t *testing.T) {
	const key = "YNX_TEST_BOOLEAN"
	tests := []struct {
		name     string
		value    string
		fallback bool
		want     bool
		wantErr  bool
	}{
		{name: "unset uses fallback", fallback: true, want: true},
		{name: "true", value: " true ", want: true},
		{name: "false", value: "FALSE"},
		{name: "reject yes", value: "yes", wantErr: true},
		{name: "reject one", value: "1", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(key, tt.value)
			got, err := envBool(key, tt.fallback)
			if (err != nil) != tt.wantErr {
				t.Fatalf("envBool() error = %v, wantErr %t", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("envBool() = %t, want %t", got, tt.want)
			}
		})
	}
}
