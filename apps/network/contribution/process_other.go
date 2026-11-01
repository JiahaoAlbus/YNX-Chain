//go:build !unix

package contribution

import "os"

// Do not pretend portable file modes establish executable ownership on a
// platform whose original owner validation adapter has not been supplied.
func processCurrentOwner(os.FileInfo) bool { return false }

func processUnlinkCapture(*os.File) error { return ErrUnsupported }
