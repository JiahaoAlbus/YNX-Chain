//go:build darwin || linux

package aiproduct

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"golang.org/x/sys/unix"
)

// PUBLIC C/F control peer only, not a Node WeakMap ticket, Auth Source or D
// signed-binding decoder. It exercises actual SCM inventory and final F IO at
// the real receiver mutex. No production constructor accepts this fixture.
func p08MountedContinuationExchange(socket string, body []byte) (link.LocalCallerResponse, error) {
	return p08MountedContinuationProbe(socket, body, true)
}
func p08MountedContinuationProbe(socket string, body []byte, expectClaim bool) (link.LocalCallerResponse, error) {
	var out link.LocalCallerResponse
	data, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		return out, err
	}
	defer data.Close()
	_ = data.SetDeadline(time.Now().Add(5 * time.Second))
	pair, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err != nil {
		return out, err
	}
	file := os.NewFile(uintptr(pair[1]), "PUBLIC-control-peer")
	conn, err := net.FileConn(file)
	_ = file.Close()
	if err != nil {
		_ = unix.Close(pair[0])
		return out, err
	}
	control := conn.(*net.UnixConn)
	defer control.Close()
	_ = control.SetDeadline(time.Now().Add(5 * time.Second))
	_, _, err = data.WriteMsgUnix([]byte{'R'}, unix.UnixRights(pair[0]), nil)
	_ = unix.Close(pair[0])
	if err != nil {
		return out, err
	}
	digest := sha256.Sum256(body)
	done := make(chan error, 1)
	go func() {
		sequence := uint32(0)
		currents, claims := 0, 0
		for {
			var size [4]byte
			if _, err := io.ReadFull(control, size[:]); err != nil {
				if err == io.EOF {
					if (expectClaim && (currents == 0 || claims != 1)) || (!expectClaim && (currents != 0 || claims != 0)) {
						done <- fmt.Errorf("PUBLIC missing exact C/F sequence: C=%d F=%d", currents, claims)
					} else {
						done <- nil
					}
				} else {
					done <- err
				}
				return
			}
			if binary.BigEndian.Uint32(size[:]) != 37 {
				done <- fmt.Errorf("PUBLIC control frame size")
				return
			}
			frame := make([]byte, 37)
			if _, err := io.ReadFull(control, frame); err != nil {
				done <- err
				return
			}
			sequence++
			if binary.BigEndian.Uint32(frame[1:5]) != sequence || !bytes.Equal(frame[5:], digest[:]) || (frame[0] != 'C' && frame[0] != 'F') {
				done <- fmt.Errorf("PUBLIC C/F correlation")
				return
			}
			if frame[0] == 'C' {
				currents++
			} else {
				claims++
				if claims > 1 {
					done <- fmt.Errorf("PUBLIC repeated F")
					return
				}
			}
			response := make([]byte, 47)
			binary.BigEndian.PutUint32(response, 43)
			copy(response[4:], frame)
			if _, err := control.Write(response); err != nil {
				done <- err
				return
			}
		}
	}()
	req, err := http.NewRequest("POST", "http://unix"+OriginalTaskReadExecutePath, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Host = OriginalTaskReadResourceService
	req.Header.Set("Content-Type", "application/json")
	req.Close = true
	if err = req.Write(data); err != nil {
		return out, err
	}
	response, err := http.ReadResponse(bufio.NewReader(data), req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	out.StatusCode = response.StatusCode
	out.Header = response.Header.Clone()
	out.Body, err = io.ReadAll(io.LimitReader(response.Body, OriginalTaskReadMaxResponseBytes+1))
	if err != nil {
		return out, err
	}
	// Handler return closes the actual control child; do not claim parent Source
	// approval from transport EOF. Bound waiting is only fixture cleanup.
	select {
	case controlErr := <-done:
		if controlErr != nil {
			return out, controlErr
		}
	case <-time.After(time.Second):
		return out, fmt.Errorf("PUBLIC control peer did not drain")
	}
	return out, nil
}
