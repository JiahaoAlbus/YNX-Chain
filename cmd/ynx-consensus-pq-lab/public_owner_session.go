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
	"runtime/debug"
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
	ready := f.Bool("ready", false, "report opened public scope; static preparation requires --prepare-source")
	prepare := f.Bool("prepare-source", false, "validate and hold original static public source before READY; no keys, current checkpoint or signing authority")
	timings := f.Bool("timings", false, "actual per-command nested callee timings; cold setup remains measured")
	if err := parsePQLabFlags(f, args); err != nil {
		return err
	}
	if *prepare && !*ready {
		return errors.New("static source preparation requires explicit READY")
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
	var preparation *consensus.PQLabMetricsSnapshot
	var preparedSession *consensus.PQLabPublicOwnerSessionStats
	version, status := "YNX-PQ-LAB-PUBLIC-OWNER-READY/v1", "original_public_scope_held"
	if *prepare {
		metrics := &consensus.PQLabMetrics{}
		if err = session.PrepareSource(ctx, metrics); err != nil {
			return err
		}
		// Discard dead validation allocations before READY opens proof lanes.
		debug.FreeOSMemory()
		snapshot, stats := metrics.Snapshot(), session.Stats()
		preparation, preparedSession = &snapshot, &stats
		version, status = "YNX-PQ-LAB-PUBLIC-OWNER-READY/v2", "original_public_static_source_held"
	}
	startupNS := time.Since(started).Nanoseconds()
	if *ready {
		if err = json.NewEncoder(out).Encode(struct {
			Version          string                                  `json:"version"`
			Status           string                                  `json:"status"`
			Owners           []int                                   `json:"owners"`
			StartupElapsedNS int64                                   `json:"startupElapsedNs"`
			Signed           bool                                    `json:"signed"`
			NonceReserved    bool                                    `json:"nonceReserved"`
			BootstrapLoaded  bool                                    `json:"bootstrapLoaded"`
			SyntheticOnly    bool                                    `json:"syntheticOnly"`
			AuthorityGranted bool                                    `json:"authorityGranted"`
			Preparation      *consensus.PQLabMetricsSnapshot         `json:"preparationTimings,omitempty"`
			Session          *consensus.PQLabPublicOwnerSessionStats `json:"session,omitempty"`
		}{Version: version, Status: status, Owners: owners, StartupElapsedNS: startupNS, BootstrapLoaded: *prepare, SyntheticOnly: true, Preparation: preparation, Session: preparedSession}); err != nil {
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
		var phase pqLabPublicOwnerFailurePhase
		switch command.Operation {
		case "prepare-owner":
			if command.Request.Version != "YNX-PQ-LAB-SENDER-REQUEST/v1" || command.Request.OperationID != "" || command.Request.FirstNonce != 0 || command.Request.Members != 0 || command.CheckpointHeight != 0 || command.CheckpointAppHash != "" || command.MaterialsFile != "" || command.MaterialsSHA256 != "" || command.ProofFile != "" {
				return errors.New("owner preparation has no transaction or checkpoint")
			}
			phase = pqLabPublicOwnerPrepare
			err = session.PrepareOwner(ctx, command.Request.OwnerIndex, metrics)
		case "sign":
			if command.MaterialsFile != "" || command.MaterialsSHA256 != "" || command.ProofFile != "" {
				return errors.New("sign cannot select proof authority")
			}
			phase = pqLabPublicOwnerSign
			result, err = session.Sign(ctx, command.Request, command.CheckpointHeight, command.CheckpointAppHash, metrics)
		case "recover", "close-owner":
			if command.CheckpointHeight != 0 || command.CheckpointAppHash != "" || command.MaterialsFile != "" || command.MaterialsSHA256 != "" || command.ProofFile != "" {
				return errors.New("original recovery/retirement cannot select new checkpoint")
			}
			if command.Operation == "recover" {
				phase = pqLabPublicOwnerRecover
				result, err = session.Recover(ctx, command.Request, metrics)
			} else {
				if command.Request.Version != "YNX-PQ-LAB-SENDER-REQUEST/v1" || command.Request.OperationID != "" || command.Request.FirstNonce != 0 || command.Request.Members != 0 {
					return errors.New("owner retirement has no transaction request")
				}
				phase = pqLabPublicOwnerClose
				err = session.CloseOwner(ctx, command.Request.OwnerIndex)
			}
		case "confirm":
			if command.CheckpointHeight != 0 || command.CheckpointAppHash != "" {
				return errors.New("confirm uses original independently pinned full proof")
			}
			var material consensus.PQLabProofMaterials
			var proof consensus.PQTransactionProofRequest
			phase = pqLabPublicOwnerConfirmMaterials
			material, proof, err = pqLabPublicOwnerProof(*root, command)
			if err == nil {
				phase = pqLabPublicOwnerConfirm
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
			Failure          *pqLabPublicOwnerFailureDiagnostic     `json:"failure,omitempty"`
			Timings          *consensus.PQLabMetricsSnapshot        `json:"timings,omitempty"`
			CalleeElapsedNS  int64                                  `json:"calleeElapsedNs,omitempty"`
			StartupElapsedNS int64                                  `json:"startupElapsedNs,omitempty"`
			Session          consensus.PQLabPublicOwnerSessionStats `json:"session"`
			StaticCache      *consensus.PQLabStaticCacheStats       `json:"staticCache,omitempty"`
			SourceInputs     *consensus.PQLabSenderSourceStats      `json:"sourceInputs,omitempty"`
		}{Version: "YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1", OwnerIndex: command.Request.OwnerIndex, OperationID: command.Request.OperationID, Code: "ORIGINAL_SAVED", Result: result, Session: session.Stats()}
		reply.Code, reply.Result, reply.Failure = pqLabPublicOwnerOutcome(command.Operation, phase, result, err)
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

// Optional reply telemetry, independently versioned from REPLY/v1. This is a
// closed diagnostic vocabulary, never raw errors, paths, identifiers or proof
// details. FirstCausePresent means the callee returned a non-nil error at this
// boundary; it does not recover a cause already collapsed to UNKNOWN upstream.
type pqLabPublicOwnerFailureDiagnostic struct {
	Version           string `json:"version"`
	ErrorClass        string `json:"errorClass"`
	FailurePhase      string `json:"failurePhase"`
	FirstCausePresent bool   `json:"firstCausePresent"`
}

type pqLabPublicOwnerFailurePhase uint8

const (
	pqLabPublicOwnerSign pqLabPublicOwnerFailurePhase = iota + 1
	pqLabPublicOwnerRecover
	pqLabPublicOwnerClose
	pqLabPublicOwnerConfirmMaterials
	pqLabPublicOwnerConfirm
	pqLabPublicOwnerPrepare
)

func (p pqLabPublicOwnerFailurePhase) label() string {
	switch p {
	case pqLabPublicOwnerSign:
		return "SIGN"
	case pqLabPublicOwnerRecover:
		return "RECOVER"
	case pqLabPublicOwnerClose:
		return "CLOSE_OWNER"
	case pqLabPublicOwnerConfirmMaterials:
		return "CONFIRM_MATERIALS"
	case pqLabPublicOwnerConfirm:
		return "CONFIRM"
	case pqLabPublicOwnerPrepare:
		return "PREPARE_OWNER"
	default:
		return "UNSPECIFIED"
	}
}

func pqLabPublicOwnerOutcome(operation string, phase pqLabPublicOwnerFailurePhase, result any, err error) (string, any, *pqLabPublicOwnerFailureDiagnostic) {
	if err != nil {
		code := "REJECTED"
		if errors.Is(err, consensus.ErrPQLabSenderUnknown) {
			code = "UNKNOWN"
		}
		return code, nil, &pqLabPublicOwnerFailureDiagnostic{
			Version: "YNX-PQ-LAB-PUBLIC-OWNER-FAILURE/v1", ErrorClass: pqLabPublicOwnerErrorClass(err),
			FailurePhase: phase.label(), FirstCausePresent: true,
		}
	}
	code := "ORIGINAL_SAVED"
	switch operation {
	case "prepare-owner":
		code = "OWNER_PREPARED"
	case "confirm":
		code = "PROOF_CONFIRMED_DATA"
	case "recover":
		code = "ORIGINAL_RECOVERED"
	case "close-owner":
		code = "OWNER_RETIRED"
	}
	return code, result, nil
}

func pqLabPublicOwnerErrorClass(err error) string {
	// Preserve UNKNOWN precedence, including joined/wrapped errors. A string
	// resembling that sentinel is not evidence of the original UNKNOWN state.
	switch {
	case errors.Is(err, consensus.ErrPQLabSenderUnknown):
		return "ORIGINAL_UNKNOWN"
	case errors.Is(err, consensus.ErrPQLabPublicOwnerBusy):
		return "OWNER_BUSY"
	case errors.Is(err, context.Canceled):
		return "CONTEXT_CANCELED"
	case errors.Is(err, context.DeadlineExceeded):
		return "DEADLINE_EXCEEDED"
	case errors.Is(err, os.ErrNotExist):
		return "NOT_FOUND"
	case errors.Is(err, os.ErrPermission):
		return "PERMISSION_DENIED"
	case errors.Is(err, os.ErrExist):
		return "ALREADY_EXISTS"
	}
	var proofErr *consensus.PQLightProofError
	if errors.As(err, &proofErr) {
		return "PROOF_REJECTED"
	}
	var pathErr *os.PathError
	if errors.As(err, &pathErr) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrShortWrite) {
		return "IO_FAILURE"
	}
	// These exact original callee literals have no interpolated input. Unknown
	// or changed text falls back safely; no substring/regex can expose it.
	switch err.Error() {
	case "original owner or bounded command budget refused":
		return "OWNER_SCOPE_REJECTED"
	case "original owner retired", "original owner absent or already retired", "original public owner session retired or closed":
		return "OWNER_RETIRED"
	case "actual four-node checkpoint differs from independently supplied H/AppHash", "independent original current checkpoint required", "actual checkpoint regressed behind original confirmed operation":
		return "CHECKPOINT_REJECTED"
	case "committed source changed during read", "committed source was replaced during read":
		return "SOURCE_CHANGED"
	case "actual owner nonce or balance differs from original request":
		return "NONCE_OR_BALANCE_REJECTED"
	case "operation id already belongs to different exact request", "confirmation proof differs from exact original operation", "different proof cannot replace original pending confirmation":
		return "REQUEST_CONFLICT"
	case "canonical 32-byte operation id required", "bounded exact per-owner nonce/member capacity required", "invalid original bounded batch size", "confirmation requires original public lab files", "independently pinned bounded lab proof materials required", "noncanonical lab proof materials":
		return "PUBLIC_INPUT_REJECTED"
	default:
		return "OPERATION_REJECTED"
	}
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
