//go:build (darwin || linux) && auth_public_fd_close_controls

package productreadsource

import "os"

// Explicit test-build-only OS close fault boundary. Not selected or compiled
// in normal builds, not exported and cannot install any Source/Root authority.
var originalPUBLICFDclose func(*os.File) error

func closeOriginalOwnedFD(file *os.File) error {
	if originalPUBLICFDclose != nil {
		return originalPUBLICFDclose(file)
	}
	return file.Close()
}
