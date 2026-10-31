//go:build unix

package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/sys/unix"
)

type pqLabSenderCommand struct {
	Version           string                       `json:"version"`
	Operation         string                       `json:"operation"`
	Request           consensus.PQLabSenderRequest `json:"request"`
	CheckpointHeight  int64                        `json:"checkpointHeight,string"`
	CheckpointAppHash string                       `json:"checkpointAppHash"`
	MaterialsFile     string                       `json:"materialsFile"`
	MaterialsSHA256   string                       `json:"materialsSHA256"`
	ProofFile         string                       `json:"proofFile"`
}

func runPQLabSender(args []string, out io.Writer) error {
	return runPQLabSenderInput(args, os.Stdin, out)
}

// This is original readback, not a signer or a broadcast client. A stale
// checkpoint refuses the operation and never changes the original corpus.
func runPQLabPreSigned(args []string, out io.Writer) error {
	f := flag.NewFlagSet("ynx-consensus-pq-lab presigned", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "explicit synthetic originals only")
	root := f.String("root", "", "original private lab root")
	plan := f.String("plan-sha256", "", "independent original network plan pin")
	activation := f.String("activation-sha256", "", "independent activation pin")
	workload := f.String("workload-sha256", "", "independent original workload pin")
	index := f.Int("index", -1, "original corpus transaction index")
	height := f.Int64("checkpoint-height", 0, "actual committed state height")
	hash := f.String("checkpoint-app-hash", "", "independent actual committed AppHash")
	if err := parsePQLabFlags(f, args); err != nil {
		return err
	}
	if !*synthetic || *root == "" || *plan == "" || *workload == "" || *index < 0 || *height < 1 || *hash == "" {
		return errors.New("explicit original corpus and actual checkpoint pins required")
	}
	checkpoint, err := consensus.LoadPQLabSenderCheckpoint(*root, *plan, *activation, *height, *hash)
	if err != nil {
		return err
	}
	result, err := consensus.ReadPQLabPreSigned(filepath.Join(*root, "workload"), *workload, *index, checkpoint)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}

// One owner, one inherited credential FD, and a bounded synchronous JSONL
// command stream. There is no background queue, batching timer or network.
func runPQLabSenderInput(args []string, input io.Reader, out io.Writer) error {
	f := flag.NewFlagSet("ynx-consensus-pq-lab sender", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "explicit synthetic-only online sender")
	root := f.String("root", "", "original private lab root")
	plan := f.String("plan-sha256", "", "independent original network plan pin")
	activation := f.String("activation-sha256", "", "independent original activation pin, empty only before scheduled activation")
	workload := f.String("workload-sha256", "", "independent original online workload pin")
	owner := f.Int("owner", -1, "independent owner index")
	fd := f.Int("credential-fd", -1, "already open original lab credential descriptor; no secret in flags")
	if err := parsePQLabFlags(f, args); err != nil {
		return err
	}
	if !*synthetic || *root == "" || *plan == "" || *workload == "" || *owner < 0 || *fd < 3 || *fd > 4096 {
		return errors.New("explicit original lab pins, owner and inherited credential FD required")
	}
	directory := filepath.Join(*root, "workload")
	// Recovery does not need a fresh height, but it still belongs to the exact
	// independently pinned original lab. Check this before opening custody.
	planRaw, err := readPQLabWorkloadFile(filepath.Join(*root, "network-plan.json"), 1<<20)
	if err != nil {
		return err
	}
	planHash := sha256.Sum256(planRaw)
	if hex.EncodeToString(planHash[:]) != *plan {
		return errors.New("independent original lab plan pin required")
	}
	var originalPlan consensus.PQLabNetworkPlan
	if json.Unmarshal(planRaw, &originalPlan) != nil {
		return errors.New("invalid original lab plan")
	}
	canonicalPlan, err := json.Marshal(originalPlan)
	if err != nil || !bytes.Equal(planRaw, canonicalPlan) || originalPlan.RootDir != *root || !originalPlan.SyntheticOnly || originalPlan.PublicNetwork || originalPlan.NativeChainID != consensus.PQLabNativeChainID {
		return errors.New("different original synthetic lab scope")
	}
	manifestRaw, err := readPQLabWorkloadFile(filepath.Join(directory, "PUBLIC-WORKLOAD.json"), 8<<20)
	if err != nil {
		return err
	}
	manifestHash := sha256.Sum256(manifestRaw)
	var originalManifest consensus.PQLabWorkloadManifest
	if hex.EncodeToString(manifestHash[:]) != *workload || json.Unmarshal(manifestRaw, &originalManifest) != nil || originalManifest.MigrationStateHash != originalPlan.MigrationStateHash || originalManifest.OriginalGenesisHash != originalPlan.OriginalGenesisHash {
		return errors.New("workload does not belong to original pinned lab")
	}
	credential, err := readPQLabSenderCredential(*fd, filepath.Join(directory, "private-senders", "recovery.raw"))
	if err != nil {
		return err
	}
	defer clear(credential)
	sender, err := consensus.OpenPQLabSender(directory, *workload, *owner, credential)
	if err != nil {
		return err
	}
	defer sender.Close()
	clear(credential)
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 32<<10)
	count := 0
	for scanner.Scan() {
		count++
		if count > 4*consensus.MaxPQLabTransfers+16 {
			return errors.New("bounded synchronous command budget exhausted")
		}
		raw := scanner.Bytes()
		var command pqLabSenderCommand
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&command) != nil {
			return errors.New("invalid sender command")
		}
		canonical, err := json.Marshal(command)
		if err != nil || !bytes.Equal(raw, canonical) || command.Version != "YNX-PQ-LAB-SENDER-COMMAND/v1" || command.Request.OwnerIndex != *owner {
			return errors.New("exact canonical owner command required")
		}
		var result any
		switch command.Operation {
		case "sign":
			if command.MaterialsFile != "" || command.MaterialsSHA256 != "" || command.ProofFile != "" {
				return errors.New("sign cannot accept proof-selected authority")
			}
			checkpoint, e := consensus.LoadPQLabSenderCheckpoint(*root, *plan, *activation, command.CheckpointHeight, command.CheckpointAppHash)
			err = e
			if err == nil {
				result, err = sender.Sign(command.Request, checkpoint)
			}
		case "recover":
			if command.CheckpointHeight != 0 || command.CheckpointAppHash != "" || command.MaterialsFile != "" || command.MaterialsSHA256 != "" || command.ProofFile != "" {
				return errors.New("recover accepts only the exact original operation")
			}
			result, err = sender.Recover(command.Request)
		case "confirm":
			if command.CheckpointHeight != 0 || command.CheckpointAppHash != "" {
				return errors.New("confirm uses independently pinned full proof materials")
			}
			for _, path := range []string{command.MaterialsFile, command.ProofFile} {
				relative, e := filepath.Rel(*root, path)
				if e != nil || !filepath.IsAbs(path) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || strings.Contains(path, "/private-senders/") || strings.Contains(path, "/custody/") {
					return errors.New("confirmation inputs must be original public lab files")
				}
			}
			material, e := readPQLabWorkloadFile(command.MaterialsFile, consensus.MaxPQLabProofMaterialsBytes)
			err = e
			if err == nil {
				m, e := consensus.DecodePQLabProofMaterials(material, command.MaterialsSHA256)
				err = e
				if err == nil {
					wire, e := readPQLabWorkloadFile(command.ProofFile, consensus.MaxPQTransactionProofRequestBytes)
					err = e
					if err == nil {
						proof, e := consensus.DecodePQTransactionProofRequest(wire)
						err = e
						if err == nil {
							result, err = sender.Confirm(command.Request, m, proof, time.Now().UTC())
						}
					}
				}
			}
		default:
			return errors.New("unsupported sender operation")
		}
		response := struct {
			Version string `json:"version"`
			Code    string `json:"code"`
			Result  any    `json:"result"`
		}{Version: "YNX-PQ-LAB-SENDER-REPLY/v1", Code: "ORIGINAL_SAVED", Result: result}
		if err != nil {
			response.Result = nil
			response.Code = "REJECTED"
			if errors.Is(err, consensus.ErrPQLabSenderUnknown) {
				response.Code = "UNKNOWN"
			}
		} else if command.Operation == "confirm" {
			response.Code = "PROOF_CONFIRMED_DATA"
		} else if command.Operation == "recover" {
			response.Code = "ORIGINAL_RECOVERED"
		}
		if err = json.NewEncoder(out).Encode(response); err != nil {
			return err
		}
	}
	if err = scanner.Err(); err != nil {
		return err
	}
	if count == 0 {
		return errors.New("at least one bounded sender command required")
	}
	return nil
}

func readPQLabSenderCredential(fd int, expectedPath string) ([]byte, error) {
	resolved, err := filepath.EvalSymlinks(expectedPath)
	if err != nil || resolved != expectedPath {
		return nil, errors.New("original synthetic credential unavailable")
	}
	copyFD, err := unix.Dup(fd)
	if err != nil {
		return nil, errors.New("inherited credential FD unavailable")
	}
	unix.CloseOnExec(copyFD)
	f := os.NewFile(uintptr(copyFD), "inherited-synthetic-credential")
	defer f.Close()
	info, err := f.Stat()
	original, pathErr := os.Lstat(expectedPath)
	var st unix.Stat_t
	if err != nil || pathErr != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() != 32 || !os.SameFile(info, original) || unix.Fstat(copyFD, &st) != nil || st.Nlink != 1 || st.Uid != uint32(os.Getuid()) {
		return nil, errors.New("exact private original inherited credential required")
	}
	credential := make([]byte, 32)
	if n, err := f.ReadAt(credential, 0); err != nil || n != 32 {
		clear(credential)
		return nil, errors.New("inherited credential read failed")
	}
	return credential, nil
}

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
