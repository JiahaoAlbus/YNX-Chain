//go:build !darwin && !linux

package nativeconsent

import "os"

func owned(os.FileInfo) bool    { return false }
func unlink(*os.File) error     { return ErrUnavailable }
func unlinkInfo(*os.File) error { return ErrUnavailable }
