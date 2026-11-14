//go:build !darwin && !linux

package ownednode

import "os"

func platformSupported() bool                         { return false }
func openManagerRoot(string) (*os.File, error)         { return nil, ErrUnsupported }
func openManagerLock(*os.File, bool) (*os.File, error) { return nil, ErrUnsupported }
func validManagerLock(os.FileInfo, uint32) bool        { return false }
func sameManagerLockSnapshot(os.FileInfo, os.FileInfo) bool {
	return false
}
func openRegularRead(string) (*os.File, error)       { return nil, ErrUnsupported }
func ownerUID(os.FileInfo) (uint32, error)           { return 0, ErrUnsupported }
func lockFile(*os.File) error                        { return ErrUnsupported }
func freeBytes(string) (uint64, error)               { return 0, ErrUnsupported }
func identity(os.FileInfo) FileIdentity              { return FileIdentity{} }
func publishArtifact(*os.File, string, string) error { return ErrUnsupported }
func unlinkManagedFile(*os.File, string) error       { return ErrUnsupported }
