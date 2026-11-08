//go:build (darwin || linux) && !auth_public_fd_close_controls

package productreadsource

import "os"

// Production has no provider/setter or configurable close primitive.
func closeOriginalOwnedFD(file *os.File) error { return file.Close() }
