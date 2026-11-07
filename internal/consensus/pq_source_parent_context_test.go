//go:build linux || darwin

package consensus

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestSourceParentFrameBounds(t *testing.T) {
	b := make([]byte, 72)
	binary.BigEndian.PutUint64(b[:8], 4)
	binary.BigEndian.PutUint64(b[8:16], 1893456000000)
	binary.BigEndian.PutUint64(b[16:24], 41)
	copy(b[24:66], "0x"+strings.Repeat("a", 40))
	binary.BigEndian.PutUint16(b[66:68], 1)
	binary.BigEndian.PutUint16(b[68:70], 1)
	binary.BigEndian.PutUint16(b[70:72], 1)
	b = append(b, 'c', 's', 'i')
	if s, e := decodeSourceBind(b, 4); e != nil || s.deadlineMs != 1893456000000 {
		t.Fatal(e)
	}
	for _, mode := range []string{"generation", "height", "owner", "length", "UTF8", "trailing"} {
		t.Run(mode, func(t *testing.T) {
			x := append([]byte(nil), b...)
			switch mode {
			case "generation":
				x[7] = 5
			case "height":
				clear(x[16:24])
			case "owner":
				x[25] = 'X'
			case "length":
				x[67] = 0
			case "UTF8":
				x[len(x)-1] = 255
			case "trailing":
				x = append(x, 0)
			}
			if _, e := decodeSourceBind(x, 4); e == nil {
				t.Fatal("bad source bind accepted")
			}
		})
	}
	cancel := make([]byte, 20)
	binary.BigEndian.PutUint64(cancel[:8], 4)
	binary.BigEndian.PutUint32(cancel[8:12], 1)
	binary.BigEndian.PutUint32(cancel[16:20], 5)
	f, e := decodeSourceCancel(cancel, 4)
	if e != nil || !f.present || f.code != 0 {
		t.Fatal("original failure0 lost", e)
	}
	var head [16]byte
	copy(head[:8], "YNXSPAR1")
	binary.BigEndian.PutUint16(head[8:10], 1)
	head[10] = 1
	binary.BigEndian.PutUint32(head[12:16], 1025)
	if _, _, e = readSourceFrame(bytes.NewReader(head[:])); e == nil {
		t.Fatal("oversize frame accepted")
	}
	_, _, e = readSourceFrame(io.LimitReader(bytes.NewReader(head[:]), 2))
	if e == nil {
		t.Fatal("truncated header accepted")
	}
}

// Isolated clock/lock controls AFTER qualification, not genuine Source grants.
func TestSourceParentOriginalClockRace(t *testing.T) {
	for _, mode := range []string{"already-expired", "near-expiry", "earlier-process-deadline", "actual-process-cancel"} {
		t.Run(mode, func(t *testing.T) {
			process, cancel := context.WithCancel(context.Background())
			defer cancel()
			originalMs := uint64(time.Now().Add(time.Second).UnixMilli())
			if mode == "already-expired" {
				originalMs = uint64(time.Now().Add(-time.Millisecond).UnixMilli())
			}
			if mode == "near-expiry" {
				originalMs = uint64(time.Now().Add(time.Millisecond).UnixMilli())
			}
			if mode == "earlier-process-deadline" {
				var end context.CancelFunc
				process, end = context.WithDeadline(process, time.Now().Add(time.Millisecond))
				defer end()
			}
			p := armOriginalSourceClock(process, sourceParentSelection{generation: 1, deadlineMs: originalMs}, nil)
			if p.originalSourceDeadlineMs() != originalMs {
				t.Fatal("original Source deadline changed")
			}
			if mode == "actual-process-cancel" {
				cancel()
			}
			select {
			case <-p.Done():
			case <-time.After(2 * time.Second):
				t.Fatal("original clock/process signal failed")
			}
			if mode == "actual-process-cancel" && !errors.Is(p.Err(), context.Canceled) {
				t.Fatal(p.Err())
			}
			if mode != "actual-process-cancel" && !errors.Is(p.Err(), context.DeadlineExceeded) {
				t.Fatal(p.Err())
			}
			if mode == "already-expired" && p.Err() == nil {
				t.Fatal("expired initial BIND treated ready")
			}
			if p.stopProcess != nil {
				p.stopProcess()
			}
		})
	}
}
