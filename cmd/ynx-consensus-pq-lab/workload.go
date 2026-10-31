//go:build unix

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/sys/unix"
)

// This operation does not query RPC, generate headers, sign votes or start a
// node. The operator must pin its real checkpoint/target materials separately
// from the untrusted proof. The normal verifier receives unchanged v1 inputs.
func runPQLabProofContext(args []string, out io.Writer) error {
	f := flag.NewFlagSet("ynx-consensus-pq-lab proof-context", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "explicit synthetic loopback inputs only")
	materials := f.String("materials", "", "canonical public checkpoint/target material file")
	pin := f.String("materials-sha256", "", "independent SHA256 pin of exact approved material bytes")
	proofPath := f.String("proof", "", "untrusted canonical transaction proof request file")
	output := f.String("output", "", "fresh exclusive absolute proof context directory")
	if err := parsePQLabFlags(f, args); err != nil {
		return err
	}
	if !*synthetic || *materials == "" || *pin == "" || *proofPath == "" || *output == "" {
		return errors.New("synthetic acknowledgement and separate pinned material/proof/output required")
	}
	raw, err := readPQLabWorkloadFile(*materials, consensus.MaxPQLabProofMaterialsBytes)
	if err != nil {
		return err
	}
	m, err := consensus.DecodePQLabProofMaterials(raw, *pin)
	if err != nil {
		return err
	}
	proofRaw, err := readPQLabWorkloadFile(*proofPath, consensus.MaxPQTransactionProofRequestBytes)
	if err != nil {
		return err
	}
	proof, err := consensus.DecodePQTransactionProofRequest(proofRaw)
	if err != nil {
		return err
	}
	result, err := consensus.WritePQLabProofInputs(*output, m, proof, time.Now().UTC())
	if err != nil {
		return err
	}
	// A broken output acknowledgement never removes the existing originals.
	return json.NewEncoder(out).Encode(result)
}

func readPQLabWorkloadFile(path string, maximum int64) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("canonical original public input path required")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("aliased public input refused")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "public-lab-input")
	defer f.Close()
	before, err := f.Stat()
	if err != nil {
		return nil, err
	}
	var st unix.Stat_t
	if unix.Fstat(fd, &st) != nil || !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || st.Nlink != 1 || before.Size() <= 0 || before.Size() > maximum {
		return nil, errors.New("bounded immutable regular public input required")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil {
		return nil, err
	}
	after, err := f.Stat()
	current, pathErr := os.Lstat(path)
	if err != nil || pathErr != nil || len(raw) != int(before.Size()) || !os.SameFile(before, after) || !os.SameFile(before, current) || current.Mode()&os.ModeSymlink != 0 || after.Size() != before.Size() || current.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) || !current.ModTime().Equal(before.ModTime()) {
		return nil, errors.New("public input changed during read")
	}
	return raw, nil
}
