package receipt

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// PQCommandVerifier consumes the original CORE command's pinned host context.
// Only local startup configuration selects executable/context; HTTP proof data
// supplies neither paths, target, clock nor authority. All consensus parsing,
// source recovery and cryptography remain in the original command.
type PQCommandVerifier struct {
	mu                                       sync.RWMutex
	dir, executable, contextPath, contextPin string
	expected                                 json.RawMessage
	target                                   struct {
		TransactionHash string `json:"transactionHash"`
		NativeWireHash  string `json:"nativeWireHash"`
		Index           string `json:"index"`
		TransactionType string `json:"transactionType"`
		NativeWire      []byte `json:"nativeWire"`
		Block           struct {
			HeaderHeight string `json:"headerHeight"`
		} `json:"block"`
	}
	life    context.Context
	cancel  context.CancelFunc
	closed  bool
	members map[string]uint32
}

func pinnedPublicFile(path, pin string, limit int64) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("absolute pinned public file required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit || info.Mode().Perm()&0022 != 0 {
		return nil, errors.New("unsafe public file or bound")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("public file replaced")
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(raw)) != info.Size() {
		return nil, errors.New("public file changed or exceeded bound")
	}
	after, err := f.Stat()
	if err != nil || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return nil, errors.New("public file changed")
	}
	h := sha256.Sum256(raw)
	if hex.EncodeToString(h[:]) != pin {
		return nil, errors.New("independent file digest mismatch")
	}
	return raw, nil
}

// OpenPQCommandVerifier captures immutable private copies of exactly pinned
// public bytes. The context's original source paths stay unchanged and CORE
// validates their own hashes/authority at every invocation. No successful proof
// is implied by configuring this bridge.
func OpenPQCommandVerifier(executable, executablePin, hostContext, contextPin string) (*PQCommandVerifier, error) {
	code, err := pinnedPublicFile(executable, executablePin, 256<<20)
	if err != nil {
		return nil, err
	}
	raw, err := pinnedPublicFile(hostContext, contextPin, 16<<20)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Version  string          `json:"version"`
		Expected json.RawMessage `json:"expectedTransaction"`
	}
	if json.Unmarshal(raw, &doc) != nil || doc.Version != "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1" || len(doc.Expected) == 0 {
		return nil, errors.New("original transaction trust context required")
	}
	v := &PQCommandVerifier{expected: doc.Expected, contextPin: contextPin}
	if json.Unmarshal(doc.Expected, &v.target) != nil {
		return nil, errors.New("missing pinned transaction target")
	}
	for _, h := range []string{v.target.TransactionHash, v.target.NativeWireHash} {
		if _, err := hashBytes(h); err != nil {
			return nil, errors.New("invalid pinned target hash")
		}
	}
	v.members = map[string]uint32{}
	if v.target.TransactionType == consensus.PQWholeType {
		whole, err := ynxbatch.DecodeWhole(v.target.NativeWire)
		if err != nil {
			return nil, errors.New("invalid pinned original Whole")
		}
		for i := range whole.Messages {
			hash, err := chain.PQBatchTransactionHash("0x"+hex.EncodeToString(mustHash(v.target.NativeWireHash)), uint32(i))
			if err != nil {
				return nil, err
			}
			decoded, err := hashBytes(hash)
			if err != nil {
				return nil, err
			}
			v.members[hex.EncodeToString(decoded)] = uint32(i)
		}
	}
	dir, err := os.MkdirTemp("", "ynx-network-proof-")
	if err != nil {
		return nil, err
	}
	canonical, err := filepath.EvalSymlinks(dir)
	if err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	v.dir = canonical
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(v.dir)
		}
	}()
	v.executable = filepath.Join(v.dir, "original-proof-verifier")
	v.contextPath = filepath.Join(v.dir, "host-context.json")
	if err = os.WriteFile(v.executable, code, 0500); err != nil {
		return nil, err
	}
	if err = os.WriteFile(v.contextPath, raw, 0400); err != nil {
		return nil, err
	}
	v.life, v.cancel = context.WithCancel(context.Background())
	ok = true
	return v, nil
}

func (v *PQCommandVerifier) Close() error {
	v.cancel()
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return nil
	}
	v.closed = true
	return os.RemoveAll(v.dir)
}

type proofOutput struct {
	bytes.Buffer
	cancel context.CancelFunc
}

func (b *proofOutput) Write(p []byte) (int, error) {
	if len(p) > 4<<20-b.Len() {
		b.cancel()
		return 0, errors.New("original proof output bound")
	}
	return b.Buffer.Write(p)
}

func (v *PQCommandVerifier) Verify(ctx context.Context, txID string, raw []byte) PQProofView {
	out := PQProofView{ProofView: ProofView{Level: RPCOnly, TxID: txID}, StateScope: "transaction-result-only"}
	fail := func(reason, detail string) PQProofView { out.Reason = reason; out.Detail = detail; return out }
	observed, err := decodePQCollector(raw)
	if err != nil {
		return fail("BAD_PROOF", "原 PQ 收集器传输格式无效。")
	}
	out.Source = observed.Source
	if v == nil {
		return fail("NOT_SUPPLIED", "尚未配置独立固定的原 CORE 信任上下文。")
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	if v.closed {
		return fail("REVOKED", "本机原生证明通道已关闭。")
	}
	requested, err := hashBytes(txID)
	selected, isMember := v.members[hex.EncodeToString(requested)]
	if err != nil || (!isMember && !samePQHash(v.target.TransactionHash, requested) && !samePQHash(v.target.NativeWireHash, requested)) {
		return fail("BAD_PROOF", "交易与独立信任上下文固定的目标不符。")
	}
	if isMember {
		out.RequestedMember = strconv.FormatUint(uint64(selected), 10)
	}
	if strconv.FormatUint(observed.ExecutionHeight, 10) != v.target.Block.HeaderHeight || observed.CometIndex == nil || strconv.FormatUint(uint64(*observed.CometIndex), 10) != v.target.Index || !samePQHash(observed.ABCITransactionHash, mustHash(v.target.TransactionHash)) || !samePQHash(observed.NativeTransactionHash, mustHash(v.target.NativeWireHash)) {
		return fail("BAD_PROOF", "收集器观测目标与独立固定的交易位置不符。")
	}
	if len(observed.Proof) == 0 {
		return fail("NOT_SUPPLIED", "收集器尚未提供原生证明。")
	}
	input, err := json.Marshal(struct {
		Version  string          `json:"version"`
		Expected json.RawMessage `json:"expected"`
		Proof    json.RawMessage `json:"proof"`
	}{"YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", v.expected, observed.Proof})
	if err != nil {
		return fail("BAD_PROOF", "证明编码无效。")
	}
	run, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	stop := context.AfterFunc(v.life, cancel)
	defer stop()
	cmd := exec.CommandContext(run, v.executable, "--trust-context", v.contextPath, "--trust-context-sha256", v.contextPin)
	cmd.Stdin = bytes.NewReader(input)
	output := &proofOutput{cancel: cancel}
	cmd.Stdout = output
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	if err = cmd.Run(); err != nil {
		if run.Err() != nil {
			return fail("CANCELLED", "原生证明调用已取消或超时。")
		}
		return fail("BAD_PROOF", "原 CORE 拒绝本次证明或独立信任材料。")
	}
	var reply struct {
		Version string                              `json:"version"`
		Code    string                              `json:"code"`
		Result  *consensus.PQTransactionProofResult `json:"result"`
	}
	if json.Unmarshal(output.Bytes(), &reply) != nil || reply.Version != "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1" || reply.Result == nil {
		return fail("BAD_PROOF", "原 CORE 返回格式无效。")
	}
	r := reply.Result
	validCode := (reply.Code == "VERIFIED_TRANSACTION_DATA" && r.Outcome == "succeeded") || (reply.Code == "VERIFIED_TRANSACTION_REJECTED_DATA" && r.Outcome == "rejected") || (reply.Code == "VERIFIED_TRANSACTION_PARTIAL_DATA" && r.Outcome == "partial")
	if !validCode || !r.Included || !r.Finalized || r.NativeGrant || r.Classification != "data" || strconv.FormatInt(r.Height, 10) != v.target.Block.HeaderHeight || strconv.FormatInt(r.Index, 10) != v.target.Index || !samePQHash(r.TransactionHash, mustHash(v.target.TransactionHash)) || !samePQHash(r.NativeWireHash, mustHash(v.target.NativeWireHash)) {
		return fail("BAD_PROOF", "原 CORE 未返回绑定交易的真实证明结果。")
	}
	if run.Err() != nil {
		return fail("CANCELLED", "原生证明已取消。")
	}
	out.Height = v.target.Block.HeaderHeight
	out.ABCIResultVerified = true
	out.ExecutionOutcome = r.Outcome
	out.ABCIExecutionCode = strconv.FormatUint(uint64(r.ExecutionCode), 10)
	if isMember {
		for _, member := range r.BatchResults {
			if member.Index == selected {
				if member.Outcome == "admitted" && !samePQHash(member.TransactionHash, requested) {
					return fail("BAD_PROOF", "原生结果中的成员与请求不符。")
				}
				out.SelectedMemberResultVerified = true
				out.SelectedMemberOutcome = member.Outcome
				break
			}
		}
	}
	out.Level = InclusionVerified
	return fail("STATE_NOT_PROVEN", "原 CORE 已验证交易包含和确定性执行结果；未验证资金、账户或发票状态。")
}

// CollectorLookupID binds a selected member to its independently pinned Whole
// before any RPC call. RPC data never chooses the original envelope or member.
func (v *PQCommandVerifier) CollectorLookupID(txID string) (string, error) {
	if v == nil {
		return txID, nil
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	if v.closed {
		return "", errors.New("proof host closed")
	}
	hash, err := hashBytes(txID)
	if err != nil {
		return "", err
	}
	_, member := v.members[hex.EncodeToString(hash)]
	if !member && !samePQHash(v.target.TransactionHash, hash) && !samePQHash(v.target.NativeWireHash, hash) {
		return "", errors.New("transaction not configured in pinned host context")
	}
	return "0x" + hex.EncodeToString(mustHash(v.target.NativeWireHash)), nil
}

func mustHash(s string) []byte { h, _ := hashBytes(s); return h }
