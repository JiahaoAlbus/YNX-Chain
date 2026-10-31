//go:build !darwin && !linux

package ownednode

import "os"

func platformSupported() bool              { return false }
func ownerUID(os.FileInfo) (uint32, error) { return 0, ErrUnsupported }
func lockFile(*os.File) error              { return ErrUnsupported }
func unlockFile(*os.File) error            { return ErrUnsupported }
func freeBytes(string) (uint64, error)     { return 0, ErrUnsupported }
