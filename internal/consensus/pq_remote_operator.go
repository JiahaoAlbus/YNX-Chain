//go:build unix

package consensus

import (
	"bytes"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/protoio"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"golang.org/x/sys/unix"
)

type PQOperatorFiles struct {
	Migration, Genesis, State, Schedule, ScheduleHash, Binding string
	Pins                                                       ConsensusBootstrapPins
}
type PQOperatorInputs struct {
	Migration     chain.ConsensusMigrationState
	Bootstrap     *ConsensusBootstrap
	Authorization *PQEngineAuthorization
	Binding       ynxconsensusauth.HostKeyBinding
}

func readPQOperatorFile(path string, limit int64, private bool) ([]byte, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "pq-operator-file")
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("operator file must be a bounded existing regular file")
	}
	var stat unix.Stat_t
	if err = unix.Fstat(fd, &stat); err != nil {
		return nil, err
	}
	if private && (info.Mode().Perm() != 0600 || stat.Nlink != 1) {
		return nil, errors.New("private operator file must be original single-link 0600 file")
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(raw)) > limit {
		clear(raw)
		return nil, errors.New("operator file read failed or exceeded bound")
	}
	return raw, nil
}
func LoadPQOperatorInputs(files PQOperatorFiles) (*PQOperatorInputs, error) {
	if files.State == "" {
		return nil, errors.New("original committed state path is required")
	}
	migrationRaw, err := readPQOperatorFile(files.Migration, 1<<30, false)
	if err != nil {
		return nil, err
	}
	in := new(PQOperatorInputs)
	if err = json.Unmarshal(migrationRaw, &in.Migration); err != nil {
		return nil, err
	}
	genesis, err := readPQOperatorFile(files.Genesis, 64<<20, false)
	if err != nil {
		return nil, err
	}
	in.Bootstrap, err = NewConsensusBootstrap(genesis, files.Pins, in.Migration)
	if err != nil {
		return nil, err
	}
	schedule, err := readPQOperatorFile(files.Schedule, 32<<10, false)
	if err != nil {
		return nil, err
	}
	in.Authorization, err = NewPQEngineAuthorization(schedule, files.ScheduleHash)
	if err != nil {
		return nil, err
	}
	binding, err := readPQOperatorFile(files.Binding, 64<<10, false)
	if err != nil {
		return nil, err
	}
	d := json.NewDecoder(bytes.NewReader(binding))
	d.DisallowUnknownFields()
	if err = d.Decode(&in.Binding); err != nil {
		return nil, err
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, errors.New("binding has trailing data")
	}
	canonical, err := json.Marshal(in.Binding)
	if err != nil || !bytes.Equal(canonical, bytes.TrimSpace(binding)) {
		return nil, errors.New("public binding is not canonical exact JSON")
	}
	if err = in.Binding.Validate(); err != nil {
		return nil, err
	}
	if err = validatePQRemoteBinding(in.Bootstrap, in.Authorization, in.Binding); err != nil {
		return nil, err
	}
	return in, nil
}
func ReadPQRecoveryCredential(fd int) ([]byte, error) {
	if fd < 3 {
		return nil, errors.New("credential requires inherited private descriptor >=3")
	}
	f := os.NewFile(uintptr(fd), "pq-recovery-credential")
	if f == nil {
		return nil, errors.New("private credential descriptor unavailable")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 33))
	if err != nil || len(raw) != 32 {
		clear(raw)
		return nil, errors.New("private credential must be exactly 32 raw bytes and EOF")
	}
	return raw, nil
}

// LoadPQOriginalLegacyValidator loads both original files without the stock
// load helper's process exit or its public identity overwrite. It never Save()s
// on load, generates a key, or reconstructs an absent H/R/S. Caller owns lease.
func LoadPQOriginalLegacyValidator(keyPath, statePath, chainID string) (*privval.FilePV, error) {
	if chainID == "" {
		return nil, errors.New("original legacy history requires independent chain identity")
	}
	raw, err := readPQOperatorFile(keyPath, 64<<10, true)
	if err != nil {
		return nil, err
	}
	defer clear(raw)
	var key privval.FilePVKey
	if err = cmtjson.Unmarshal(raw, &key); err != nil {
		return nil, errors.New("invalid original legacy validator key")
	}
	private, ok := key.PrivKey.(cmted.PrivKey)
	if !ok || len(private) != cmted.PrivateKeySize {
		return nil, errors.New("original legacy validator must be Ed25519")
	}
	retained := false
	defer func() {
		if !retained {
			clear(private)
		}
	}()
	derived := ed25519.NewKeyFromSeed(private[:ed25519.SeedSize])
	defer clear(derived)
	if !bytes.Equal(derived, private) {
		clear(private)
		return nil, errors.New("original legacy key material is inconsistent")
	}
	public := private.PubKey()
	if key.PubKey == nil || !key.PubKey.Equals(public) || !bytes.Equal(key.Address, public.Address()) {
		return nil, errors.New("original legacy public identity differs from private key")
	}
	state, err := readPQOperatorFile(statePath, 2<<20, true)
	if err != nil {
		return nil, err
	}
	pv := privval.NewFilePV(private, keyPath, statePath)
	if err = cmtjson.Unmarshal(state, &pv.LastSignState); err != nil {
		return nil, errors.New("invalid original legacy signing history")
	}
	s := pv.LastSignState
	if s.Height < 0 || s.Round < 0 || s.Step < 0 || s.Step > 3 {
		return nil, errors.New("invalid original legacy H/R/S")
	}
	if s.Height == 0 {
		if s.Round != 0 || s.Step != 0 || len(s.Signature) != 0 || len(s.SignBytes) != 0 {
			return nil, errors.New("inconsistent initial legacy history")
		}
	} else {
		if s.Step == 0 || len(s.Signature) != cmted.SignatureSize || len(s.SignBytes) == 0 || !public.VerifySignature(s.SignBytes, s.Signature) {
			return nil, errors.New("original legacy saved signature is invalid or missing")
		}
		if err = validatePQOriginalLegacyCoordinates(s, chainID); err != nil {
			return nil, err
		}
	}
	retained = true
	return pv, nil
}

func validatePQOriginalLegacyCoordinates(state privval.FilePVLastSignState, chainID string) error {
	invalid := errors.New("original legacy signed bytes differ from persisted chain/H/R/S")
	n, prefix := binary.Uvarint(state.SignBytes)
	if prefix <= 0 || n != uint64(len(state.SignBytes)-prefix) {
		return invalid
	}
	raw := state.SignBytes[prefix:]
	if state.Step == 1 {
		var p cmtproto.CanonicalProposal
		if err := p.Unmarshal(raw); err != nil {
			return invalid
		}
		canonical, err := protoio.MarshalDelimited(&p)
		if err != nil || !bytes.Equal(canonical, state.SignBytes) || p.Type != cmtproto.ProposalType || p.ChainID != chainID || p.Height != state.Height || p.Round != int64(state.Round) {
			return invalid
		}
	} else {
		var v cmtproto.CanonicalVote
		if err := v.Unmarshal(raw); err != nil {
			return invalid
		}
		canonical, err := protoio.MarshalDelimited(&v)
		expected := cmtproto.PrevoteType
		if state.Step == 3 {
			expected = cmtproto.PrecommitType
		}
		if err != nil || !bytes.Equal(canonical, state.SignBytes) || v.Type != expected || v.ChainID != chainID || v.Height != state.Height || v.Round != int64(state.Round) {
			return invalid
		}
	}
	return nil
}
