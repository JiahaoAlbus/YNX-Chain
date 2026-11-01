//go:build !darwin

package contribution

import "os"

func measureProcess(*os.ProcessState, *OSControls, bool) *ProcessUsage { return nil }
