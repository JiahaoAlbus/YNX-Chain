//go:build linux

package grantruntime

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func observeReceiverProcess(pid int) (receiverProcessObservation, error) {
	var out receiverProcessObservation
	if pid <= 0 {
		return out, ErrProof
	}
	base := fmt.Sprintf("/proc/%d/", pid)
	path, e := os.Readlink(base + "exe")
	if e != nil {
		return out, e
	}
	status, e := os.ReadFile(base + "status")
	if e != nil {
		return out, e
	}
	uidOK, gidOK := false, false
	for _, line := range strings.Split(string(status), "\n") {
		f := strings.Fields(line)
		if len(f) != 5 {
			continue
		}
		if f[0] != "Uid:" && f[0] != "Gid:" {
			continue
		}
		n, e := strconv.ParseUint(f[2], 10, 32)
		if e != nil || strconv.FormatUint(n, 10) != f[2] {
			return out, ErrProof
		}
		if f[0] == "Uid:" {
			out.UID = uint32(n)
			uidOK = true
		} else {
			out.GID = uint32(n)
			gidOK = true
		}
	}
	if !uidOK || !gidOK {
		return out, ErrCurrent
	}
	stat, e := os.ReadFile(base + "stat")
	if e != nil {
		return out, e
	}
	end := strings.LastIndex(string(stat), ") ")
	if end < 0 {
		return out, ErrCurrent
	}
	parts := strings.Fields(string(stat)[end+2:])
	if len(parts) < 20 || parts[0] == "Z" || parts[0] == "X" {
		return out, ErrCurrent
	}
	start, e := strconv.ParseUint(parts[19], 10, 64)
	if e != nil || start == 0 || strconv.FormatUint(start, 10) != parts[19] {
		return out, ErrCurrent
	}
	out.Path = path
	out.Start = "linux:" + parts[19]
	return out, nil
}
