//go:build !darwin && !linux

package ownednode

import "net"

func verifySynchronizationPeer(*net.UnixConn, uint32, int) error { return ErrUnsupported }
