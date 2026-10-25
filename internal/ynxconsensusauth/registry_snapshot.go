package ynxconsensusauth

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
)

const registrySnapshotDomain = "YNX-CONSENSUS-KEY-SNAPSHOT/v1\x00"

// MarshalSnapshot exports complete proofs, not a trusted checkpoint. maxBytes
// is a per-export budget, not a permanent ledger event/byte admission cap.
func (h *KeyHistory) MarshalSnapshot(maxBytes int) ([]byte, error) {
	if h == nil || h.byAddress == nil || uint64(len(h.events)) > math.MaxUint32 || maxBytes <= 0 {
		return nil, errors.New("invalid registry snapshot request")
	}
	// Check the total before allocating the variable-size field list.
	total := 4 + len(registrySnapshotDomain) + 8 + 4 + 32 + 4 + len(h.anchor.ChainID) + 8 + 4 + 32
	if total > maxBytes {
		return nil, errors.New("registry snapshot exceeds byte budget")
	}
	for _, event := range h.events {
		if maxBytes-total < 4 || len(event.wire) > maxBytes-total-4 {
			return nil, errors.New("registry snapshot exceeds byte budget")
		}
		total += 4 + len(event.wire)
	}
	f := make([][]byte, 0, len(h.events)+6)
	f = append(f, []byte(registrySnapshotDomain), regU32(RegistryVersion), h.anchor.GenesisID, []byte(h.anchor.ChainID), regU32(uint32(len(h.events))))
	for _, event := range h.events {
		f = append(f, event.wire)
	}
	f = append(f, h.root[:])
	return regEncode(maxBytes, f...)
}

// DecodeKeyHistorySnapshot rejects resource excess before allocating an event
// list, then replays all real signatures. Both anchor and expectedRoot must be
// independently authenticated by the caller; the copies in the wire are not
// authority. Missing/deleted/reordered history therefore cannot self-certify.
func DecodeKeyHistorySnapshot(wire []byte, anchor RegistryAnchor, expectedRoot [32]byte, source RegistrationStateSource, limits HistoryIngressLimits) (*KeyHistory, error) {
	if limits.MaxBytes <= 0 || limits.MaxEvents <= 0 || len(wire) > limits.MaxBytes {
		return nil, errors.New("registry snapshot exceeds ingress budget")
	}
	left := wire
	field := func() ([]byte, error) {
		if len(left) < 4 {
			return nil, errors.New("truncated registry snapshot")
		}
		n := uint64(binary.BigEndian.Uint32(left[:4]))
		left = left[4:]
		if n > uint64(len(left)) {
			return nil, errors.New("registry snapshot field exceeds input")
		}
		f := left[:int(n)]
		left = left[int(n):]
		return f, nil
	}
	header := make([][]byte, 5)
	for i := range header {
		var err error
		header[i], err = field()
		if err != nil {
			return nil, err
		}
	}
	if string(header[0]) != registrySnapshotDomain || !bytes.Equal(header[1], regU32(RegistryVersion)) || !bytes.Equal(header[2], anchor.GenesisID) || string(header[3]) != anchor.ChainID || len(header[4]) != 4 {
		return nil, errors.New("registry snapshot header differs from trusted anchor")
	}
	count := uint64(binary.BigEndian.Uint32(header[4]))
	// Every valid event contains at least one complete dual signature pair.
	// A forged count must not cause count*slice-header allocation from a tiny input.
	if count > uint64(limits.MaxEvents) || count > uint64(len(left))/(MLDSA87SignatureSize+SLHDSASHA2256fSignatureSize+4) {
		return nil, errors.New("registry snapshot event count exceeds input or budget")
	}
	wires := make([][]byte, int(count))
	for i := range wires {
		var err error
		wires[i], err = field()
		if err != nil {
			return nil, err
		}
		if len(wires[i]) > MaxRegistrationBytes {
			return nil, errors.New("oversized registry operation")
		}
	}
	root, err := field()
	if err != nil {
		return nil, err
	}
	if len(left) != 0 || !bytes.Equal(root, expectedRoot[:]) {
		return nil, errors.New("registry snapshot trailing data or untrusted root")
	}
	return ReplayKeyHistory(anchor, wires, expectedRoot, source, limits)
}
