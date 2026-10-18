package ynxpq

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
	"unicode/utf8"
)

const consensusProfileDomain = "YNX-CONSENSUS-ENGINE-PROFILE/v1\x00"
const MaxConsensusProfileBytes = 512

// ConsensusProfile is the immutable schedule commitment carried by actual
// Comet ConsensusParams. It is not a signature or authority credential.
// The application must independently pin this exact schedule and authenticate
// every validator binding against its committed historical registry.
type ConsensusProfile struct {
	GenesisID          []byte
	ChainID            string
	ParamsUpdateHeight int64
	ActivationHeight   int64
	ScheduleHash       []byte
	RegistryRoot       []byte
}

func (p ConsensusProfile) MarshalBinary() ([]byte, error) {
	if len(p.GenesisID) != 32 || zero(p.GenesisID) || len(p.ChainID) == 0 || len(p.ChainID) > 50 || !utf8.ValidString(p.ChainID) || p.ParamsUpdateHeight <= 0 || p.ParamsUpdateHeight > math.MaxInt64-3 || p.ActivationHeight < p.ParamsUpdateHeight+3 || len(p.ScheduleHash) != 32 || zero(p.ScheduleHash) || len(p.RegistryRoot) != 32 || zero(p.RegistryRoot) {
		return nil, errors.New("invalid immutable YNX consensus profile")
	}
	var heights [16]byte
	binary.BigEndian.PutUint64(heights[:8], uint64(p.ParamsUpdateHeight))
	binary.BigEndian.PutUint64(heights[8:], uint64(p.ActivationHeight))
	var wire []byte
	for _, f := range [][]byte{[]byte(consensusProfileDomain), {0, 0, 0, 1}, p.GenesisID, []byte(p.ChainID), heights[:8], heights[8:], p.ScheduleHash, p.RegistryRoot} {
		wire = field(wire, f)
	}
	return wire, nil
}

func DecodeConsensusProfile(wire []byte) (ConsensusProfile, error) {
	var p ConsensusProfile
	if len(wire) == 0 || len(wire) > MaxConsensusProfileBytes {
		return p, errors.New("invalid YNX consensus profile size")
	}
	rest := wire
	fields := make([][]byte, 0, 8)
	for len(rest) > 0 {
		if len(fields) == 8 || len(rest) < 4 {
			return p, errors.New("invalid YNX profile field count")
		}
		n := binary.BigEndian.Uint32(rest[:4])
		rest = rest[4:]
		if uint64(n) > uint64(len(rest)) {
			return p, errors.New("truncated YNX profile field")
		}
		fields = append(fields, bytes.Clone(rest[:int(n)]))
		rest = rest[int(n):]
	}
	if len(fields) != 8 || string(fields[0]) != consensusProfileDomain || !bytes.Equal(fields[1], []byte{0, 0, 0, 1}) || len(fields[4]) != 8 || len(fields[5]) != 8 {
		return p, errors.New("invalid YNX profile domain or schema")
	}
	paramHeight, activation := binary.BigEndian.Uint64(fields[4]), binary.BigEndian.Uint64(fields[5])
	if paramHeight > math.MaxInt64 || activation > math.MaxInt64 {
		return p, errors.New("invalid YNX profile height")
	}
	p = ConsensusProfile{GenesisID: fields[2], ChainID: string(fields[3]), ParamsUpdateHeight: int64(paramHeight), ActivationHeight: int64(activation), ScheduleHash: fields[6], RegistryRoot: fields[7]}
	canonical, err := p.MarshalBinary()
	if err != nil || !bytes.Equal(canonical, wire) {
		return ConsensusProfile{}, errors.New("noncanonical YNX consensus profile")
	}
	return p, nil
}
