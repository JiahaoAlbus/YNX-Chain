//go:build unix

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func runPQLabPublicOwners(args []string, out io.Writer) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runPQLabPublicOwnersOwnedInput(ctx, args, os.Stdin, out)
}

// This normal process explicitly owns its command stream. Closing it on
// cancellation wakes an idle/partial Scan. The ordinary session defer then
// joins whole operation debt; the close callback is itself joined on return.
func runPQLabPublicOwnersOwnedInput(ctx context.Context, args []string, input io.ReadCloser, out io.Writer) (resultErr error) {
	if ctx == nil || input == nil {
		return errors.New("owned original command stream and context required")
	}
	closed := make(chan struct{})
	var closeErr error
	stop := context.AfterFunc(ctx, func() { closeErr = input.Close(); close(closed) })
	defer func() {
		if !stop() {
			<-closed
		}
		resultErr = errors.Join(ctx.Err(), resultErr, closeErr)
	}()
	return runPQLabPublicOwnersInput(ctx, args, input, out)
}

func pqLabPublicOwners(text string) ([]int, error) {
	if len(text) == 0 || len(text) > 5*consensus.MaxPQLabOwners {
		return nil, errors.New("explicit bounded original owner set required")
	}
	parts := strings.Split(text, ",")
	if len(parts) > consensus.MaxPQLabOwners {
		return nil, errors.New("original owner limit exceeded")
	}
	owners := make([]int, len(parts))
	previous := -1
	for i, part := range parts {
		index, err := strconv.Atoi(part)
		if err != nil || index <= previous || index >= consensus.MaxPQLabOwners || strconv.Itoa(index) != part {
			return nil, errors.New("ascending unique canonical owner indices required")
		}
		owners[i], previous = index, index
	}
	return owners, nil
}

// One original process owns the explicit owner set. This is the existing
// synthetic lab sender, not a protected Wallet/Source/Root signing interface.
// Commands are immediate synchronous operations, never finality polling. An
// unresolved owner keeps its original intent while other owners can proceed.
func runPQLabPublicOwnersInput(ctx context.Context, args []string, input io.Reader, out io.Writer) (resultErr error) {
	started := time.Now()
	f := flag.NewFlagSet("ynx-consensus-pq-lab sender-owners", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "original synthetic custody only")
	root := f.String("root", "", "original canonical private lab root")
	plan := f.String("plan-sha256", "", "independent network plan pin")
	activation := f.String("activation-sha256", "", "independent activation pin")
	workload := f.String("workload-sha256", "", "independent online workload pin")
	ownerText := f.String("owners", "", "explicit ascending comma-separated original owner indices")
	fd := f.Int("credential-fd", -1, "original inherited synthetic credential descriptor")
	ready := f.Bool("ready", false, "report opened public scope; does not preload migration, import keys or sign")
	timings := f.Bool("timings", false, "actual per-command nested callee timings; cold setup remains measured")
	if err := parsePQLabFlags(f, args); err != nil {
		return err
	}
	owners, err := pqLabPublicOwners(*ownerText)
	if err != nil || !*synthetic || ctx == nil || ctx.Err() != nil || *root == "" || *plan == "" || *workload == "" || *fd < 3 || *fd > 4096 {
		return errors.New("original scope, explicit owner set and inherited credential required")
	}
	credential, err := readPQLabSenderCredential(*fd, filepath.Join(*root, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		return err
	}
	defer clear(credential)
	var startupMetrics *consensus.PQLabMetrics
	if *timings {
		startupMetrics = &consensus.PQLabMetrics{}
	}
	session, err := consensus.OpenPQLabPublicOwnerSession(ctx, consensus.PQLabPublicOwnerSessionOptions{RootDir: *root, PlanSHA256: *plan, ActivationSHA256: *activation, WorkloadSHA256: *workload, Owners: owners}, credential, startupMetrics)
	clear(credential)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, session.Close()) }()
	startupNS := time.Since(started).Nanoseconds()
	if *ready {
		if err = json.NewEncoder(out).Encode(struct {
			Version          string `json:"version"`
			Status           string `json:"status"`
			Owners           []int  `json:"owners"`
			StartupElapsedNS int64  `json:"startupElapsedNs"`
			Signed           bool   `json:"signed"`
			NonceReserved    bool   `json:"nonceReserved"`
			BootstrapLoaded  bool   `json:"bootstrapLoaded"`
			SyntheticOnly    bool   `json:"syntheticOnly"`
			AuthorityGranted bool   `json:"authorityGranted"`
		}{Version: "YNX-PQ-LAB-PUBLIC-OWNER-READY/v1", Status: "original_public_scope_held", Owners: owners, StartupElapsedNS: startupNS, SyntheticOnly: true}); err != nil {
			return err
		}
	}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 32<<10)
	count := uint64(0)
	limit := session.Stats().CommandLimit
	for scanner.Scan() {
		count++
		if count > limit || ctx.Err() != nil {
			return errors.New("original public owner command limit or context ended")
		}
		raw := scanner.Bytes()
		var command pqLabSenderCommand
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&command); err != nil {
			return errors.New("invalid original owner command")
		}
		canonical, e := json.Marshal(command)
		if e != nil || !bytes.Equal(raw, canonical) || command.Version != "YNX-PQ-LAB-SENDER-COMMAND/v1" {
			return errors.New("exact original canonical sender command required")
		}
		var metrics *consensus.PQLabMetrics
		if *timings {
			metrics = &consensus.PQLabMetrics{}
		}
		commandStarted := time.Now()
		var result any
		switch command.Operation {
		case "sign":
			if command.MaterialsFile != "" || command.MaterialsSHA256 != "" || command.ProofFile != "" {
				return errors.New("sign cannot select proof authority")
			}
			result, err = session.Sign(ctx, command.Request, command.CheckpointHeight, command.CheckpointAppHash, metrics)
		case "recover", "close-owner":
			if command.CheckpointHeight != 0 || command.CheckpointAppHash != "" || command.MaterialsFile != "" || command.MaterialsSHA256 != "" || command.ProofFile != "" {
				return errors.New("original recovery/retirement cannot select new checkpoint")
			}
			if command.Operation == "recover" {
				result, err = session.Recover(ctx, command.Request, metrics)
			} else {
				if command.Request.Version != "YNX-PQ-LAB-SENDER-REQUEST/v1" || command.Request.OperationID != "" || command.Request.FirstNonce != 0 || command.Request.Members != 0 {
					return errors.New("owner retirement has no transaction request")
				}
				err = session.CloseOwner(ctx, command.Request.OwnerIndex)
			}
		case "confirm":
			if command.CheckpointHeight != 0 || command.CheckpointAppHash != "" {
				return errors.New("confirm uses original independently pinned full proof")
			}
			var material consensus.PQLabProofMaterials
			var proof consensus.PQTransactionProofRequest
			material, proof, err = pqLabPublicOwnerProof(*root, command)
			if err == nil {
				result, err = session.Confirm(ctx, command.Request, material, proof, time.Now().UTC(), metrics)
			}
		default:
			return errors.New("unsupported original owner command")
		}
		reply := struct {
			Version          string                                 `json:"version"`
			OwnerIndex       int                                    `json:"ownerIndex"`
			OperationID      string                                 `json:"operationId"`
			Code             string                                 `json:"code"`
			Result           any                                    `json:"result"`
			Timings          *consensus.PQLabMetricsSnapshot        `json:"timings,omitempty"`
			CalleeElapsedNS  int64                                  `json:"calleeElapsedNs,omitempty"`
			StartupElapsedNS int64                                  `json:"startupElapsedNs,omitempty"`
			Session          consensus.PQLabPublicOwnerSessionStats `json:"session"`
			StaticCache      *consensus.PQLabStaticCacheStats       `json:"staticCache,omitempty"`
			SourceInputs     *consensus.PQLabSenderSourceStats      `json:"sourceInputs,omitempty"`
		}{Version: "YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1", OwnerIndex: command.Request.OwnerIndex, OperationID: command.Request.OperationID, Code: "ORIGINAL_SAVED", Result: result, Session: session.Stats()}
		if err != nil {
			reply.Result, reply.Code = nil, "REJECTED"
			if errors.Is(err, consensus.ErrPQLabSenderUnknown) {
				reply.Code = "UNKNOWN"
			}
		} else if command.Operation == "confirm" {
			reply.Code = "PROOF_CONFIRMED_DATA"
		} else if command.Operation == "recover" {
			reply.Code = "ORIGINAL_RECOVERED"
		} else if command.Operation == "close-owner" {
			reply.Code = "OWNER_RETIRED"
		}
		if *timings {
			m := metrics.Snapshot()
			reply.Timings = &m
			reply.StaticCache = &reply.Session.StaticCache
			reply.SourceInputs = &reply.Session.SourceInputs
			reply.CalleeElapsedNS = time.Since(commandStarted).Nanoseconds()
			if count == 1 {
				reply.StartupElapsedNS = startupNS
			}
		}
		if err = json.NewEncoder(out).Encode(reply); err != nil {
			return err // originals/debt survive lost output; never re-sign on EOF
		}
	}
	if err = scanner.Err(); err != nil {
		return err
	}
	if count == 0 && !*ready {
		return errors.New("at least one original owner command required")
	}
	return nil
}

func pqLabPublicOwnerProof(root string, command pqLabSenderCommand) (consensus.PQLabProofMaterials, consensus.PQTransactionProofRequest, error) {
	var materials consensus.PQLabProofMaterials
	var proof consensus.PQTransactionProofRequest
	for _, path := range []string{command.MaterialsFile, command.ProofFile} {
		rel, err := filepath.Rel(root, path)
		if err != nil || !filepath.IsAbs(path) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || strings.Contains(path, "/private-senders/") || strings.Contains(path, "/custody/") {
			return materials, proof, errors.New("confirmation requires original public lab files")
		}
	}
	raw, err := readPQLabWorkloadFile(command.MaterialsFile, consensus.MaxPQLabProofMaterialsBytes)
	if err != nil {
		return materials, proof, err
	}
	materials, err = consensus.DecodePQLabProofMaterials(raw, command.MaterialsSHA256)
	if err != nil {
		return materials, proof, err
	}
	raw, err = readPQLabWorkloadFile(command.ProofFile, consensus.MaxPQTransactionProofRequestBytes)
	if err == nil {
		proof, err = consensus.DecodePQTransactionProofRequest(raw)
	}
	return materials, proof, err
}
