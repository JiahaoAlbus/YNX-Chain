//go:build !darwin && !linux

package localipc

import (
	"net"
	"os"
)

func supported() bool                        { return false }
func fileOwner(os.FileInfo) (uint32, error)  { return 0, ErrUnsupported }
func kernelPeer(*net.UnixConn) (Peer, error) { return Peer{}, ErrUnsupported }

func stamp(os.FileInfo) (fileStamp, error) { return fileStamp{}, ErrUnsupported }
