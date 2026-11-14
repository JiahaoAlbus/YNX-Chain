//go:build linux || darwin

package consensus

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
)

// The v4 appendix is the original P09 broker/zero-STOP tuple, not Source
// authority. Every offered scope must still receive its own genuine BIND.
type pqOriginalFreshBrokerLaunch struct {
	original   *pqOriginalSourceLaunch
	broker     sourcePortStamp
	brokerFile *os.File
}

// Pure closed DATA decoding; this does not inspect/adopt an FD or grant Source.
// Normal capture alone calls it after Current and before original OS checks.
func decodeOriginalSourceLaunch(raw []byte, profile pqOriginalSourceProfile, expected uint16) (*pqOriginalSourceLaunch, *pqOriginalFreshBrokerLaunch, error) {
	if len(raw) < 16 || len(raw) > 13328 || string(raw[:8]) != "YNC4LCH1" || raw[10] != 1 || raw[11] != 0 || int(binary.BigEndian.Uint32(raw[12:16])) != len(raw)-16 {
		return nil, nil, errSourceParent
	}
	version := binary.BigEndian.Uint16(raw[8:10])
	if version != 3 && version != 4 || expected != 0 && version != expected {
		return nil, nil, errSourceParent
	}
	r := bytes.NewReader(raw[16:])
	var err error
	var fd uint32
	var gen, dev, ino uint64
	for _, v := range []any{&fd, &gen, &dev, &ino} {
		if binary.Read(r, binary.BigEndian, v) != nil {
			return nil, nil, errSourceParent
		}
	}
	if fd < 3 || fd > 0x7fffffff || gen == 0 || ino == 0 {
		return nil, nil, errSourceParent
	}
	l := &pqOriginalSourceLaunch{generation: gen, profile: profile, current4: sourcePortStamp{int(fd), dev, ino}}
	for i := range l.processes {
		l.processes[i], err = readSourceIdentity(r)
		if err != nil {
			return nil, nil, err
		}
	}
	if l.processes[0].PID == l.processes[1].PID || l.processes[0].PID == l.processes[2].PID || l.processes[1].PID == l.processes[2].PID {
		return nil, nil, errSourceParent
	}
	l.account, err = readSourcePort(r, 1)
	if err != nil {
		return nil, nil, err
	}
	l.control, err = readSourcePort(r, 2)
	if err != nil {
		return nil, nil, errSourceParent
	}
	var fresh *pqOriginalFreshBrokerLaunch
	if version == 4 {
		fresh = &pqOriginalFreshBrokerLaunch{original: l}
		fresh.broker, err = readSourcePort(r, 3)
		if err != nil {
			return nil, nil, err
		}
		var kind, stopFD uint32
		var stopDevice, stopInode uint64
		for _, v := range []any{&kind, &stopFD, &stopDevice, &stopInode} {
			if binary.Read(r, binary.BigEndian, v) != nil {
				return nil, nil, errSourceParent
			}
		}
		// The existing P09 v4 Core role NEVER receives the Native STOP FD.
		if kind != 4 || stopFD != 0 || stopDevice != 0 || stopInode != 0 {
			return nil, nil, errSourceParent
		}
	}
	if r.Len() != 0 {
		return nil, nil, errSourceParent
	}
	ports := []sourcePortStamp{l.current4, l.account, l.control}
	if fresh != nil {
		ports = append(ports, fresh.broker)
	}
	for i, a := range ports {
		for j, b := range ports {
			if i != j && (a.fd == b.fd || a.device == b.device && a.inode == b.inode) {
				return nil, nil, errSourceParent
			}
		}
	}
	return l, fresh, nil
}

func captureOriginalFreshBrokerLaunch(process, readCtx context.Context, profile pqOriginalSourceProfile) (*pqOriginalFreshBrokerLaunch, error) {
	_, fresh, err := captureOriginalSourceLaunchVersions(process, readCtx, profile, 4)
	return fresh, err
}
