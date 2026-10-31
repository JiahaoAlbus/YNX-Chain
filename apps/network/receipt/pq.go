package receipt

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/cometbft/cometbft/light"
)

const (
	PQCollectorVersion = "YNX-PQ-RPC-TRANSACTION-PROOF/v1"
	// This product transport cap preserves the helper's existing 4 MiB body
	// boundary; it does not enlarge the original node or proof profile limits.
	MaxPQNetworkReceiptBytes = 4 << 20
)

// PQReceiptTrust is an in-process trusted-host input. No HTTP/collector decoder
// creates it. Light must come from the original independent source/snapshot
// loader; Expected pins the exact original bytes, both hashes and both headers.
// Member, when set, selects one independently requested Whole member. A source
// label, collector flag, expected JSON or locally fabricated root grants none of
// these capabilities. There is intentionally no production trust loader here.
type PQReceiptTrust struct {
	Light    consensus.PQLightProofTrust
	Expected consensus.PQTransactionProofExpectation
	Member   *uint32
}

// PQProofView preserves the four product levels while separately reporting the
// canonical deterministic ABCI result. That result excludes events/logs and is
// not an account, invoice or funds-state membership proof. Embedded execution
// and member-state booleans remain false; no result grants replay authority.
type PQProofView struct {
	ProofView
	ABCIResultVerified           bool   `json:"abciResultVerified"`
	ExecutionOutcome             string `json:"executionOutcome,omitempty"`
	ABCIExecutionCode            string `json:"abciExecutionCode,omitempty"`
	SelectedMemberResultVerified bool   `json:"selectedMemberResultVerified"`
	SelectedMemberOutcome        string `json:"selectedMemberOutcome,omitempty"`
	StateScope                   string `json:"stateScope"`
	FundsVerified                bool   `json:"fundsVerified"`
	NativeGrant                  bool   `json:"nativeGrant"`
}

// pqCollector is the exact public PQFinalityView transport, keeping proof bytes
// raw until the original consensus decoder sees them. All other values are
// observations only, including IndependentFinality and ProofVerification.
type pqCollector struct {
	Version                 string          `json:"version"`
	Source                  string          `json:"source"`
	Status                  string          `json:"status"`
	ObservedExecutionStatus string          `json:"observedExecutionStatus,omitempty"`
	NativeTransactionHash   string          `json:"nativeTransactionHash"`
	ABCITransactionHash     string          `json:"abciTransactionHash,omitempty"`
	ExecutionHeight         uint64          `json:"executionHeight,string"`
	CometIndex              *uint32         `json:"cometIndex,omitempty"`
	IndependentFinality     bool            `json:"independentFinality"`
	ProofVerification       string          `json:"proofVerification"`
	Proof                   json.RawMessage `json:"proof,omitempty"`
	Error                   string          `json:"error,omitempty"`
}

// VerifyPQNetworkReceipt calls the original PQ-aware light and transaction
// verifiers. In particular it never coerces PQ keys into the classic verifier.
// The caller supplies the current local time for THIS invocation; Light.Now is
// ignored. Success can reach INCLUSION_VERIFIED, never STATE_VERIFIED.
func VerifyPQNetworkReceipt(txID string, trust *PQReceiptTrust, collector []byte, now time.Time) (out PQProofView) {
	v := PQProofView{ProofView: ProofView{Level: RPCOnly, TxID: txID}, StateScope: "transaction-result-only"}
	defer func() {
		if recover() != nil {
			v.Reason = "BAD_PROOF"
			v.Detail = "畸形 PQ 证明已拒绝，未取得更高验证等级。"
			out = v
		}
	}()
	fail := func(reason, detail string) PQProofView { v.Reason, v.Detail = reason, detail; return v }
	if _, err := hashBytes(txID); err != nil {
		return fail("INVALID", "交易标识必须是 32 字节十六进制摘要。")
	}
	observed, err := decodePQCollector(collector)
	if err != nil {
		return fail("BAD_PROOF", "PQ 收集器返回不符合有界、唯一字段的原始传输格式。")
	}
	v.Source = observed.Source
	if observed.ExecutionHeight > 0 {
		v.Height = fmt.Sprint(observed.ExecutionHeight)
	}
	if trust == nil {
		return fail("NOT_SUPPLIED", "仅 RPC 返回：收集器声明不提供独立信任；尚未载入原 CORE 的可信上下文。")
	}
	expected := trust.Expected
	if trust.Member != nil {
		v.RequestedMember = fmt.Sprint(*trust.Member)
	}
	if now.IsZero() {
		return fail("INVALID_TRUST", "本次本机验证时间未提供。")
	}
	if trust.Light.TrustedLightBlock != nil && trust.Light.TrustedLightBlock.SignedHeader != nil && trust.Light.TrustedLightBlock.Header != nil && trust.Light.TrustingPeriod > 0 && light.HeaderExpired(trust.Light.TrustedLightBlock.SignedHeader, trust.Light.TrustingPeriod, now) {
		return fail("EXPIRED", "独立可信头已过信任期，不能按收集器提供的时间续期。")
	}
	if err = bindPQRequestedTransaction(txID, trust); err != nil {
		return fail("BAD_PROOF", "本次交易或所选批成员与独立固定的原始字节、哈希或位置不符。")
	}
	if expected.Block.HeaderHeight <= 0 || expected.Block.HeaderHeight >= math.MaxInt64-2 || expected.Successor.HeaderHeight != expected.Block.HeaderHeight+1 || expected.Successor.ChainID != expected.Block.ChainID || expected.Index < 0 || expected.Index > math.MaxUint32 {
		return fail("BAD_PROOF", "独立目标须绑定同链相邻的执行头 H 与结果承诺头 H+1，以及原始交易位置。")
	}
	if observed.ExecutionHeight != uint64(expected.Block.HeaderHeight) || observed.CometIndex == nil || int64(*observed.CometIndex) != expected.Index || !samePQHash(observed.ABCITransactionHash, expected.TransactionHash) || !samePQHash(observed.NativeTransactionHash, expected.NativeWireHash) {
		return fail("BAD_PROOF", "RPC 观测的高度、位置或原生/外层交易身份与独立目标不同。")
	}
	if len(observed.Proof) == 0 || bytes.Equal(bytes.TrimSpace(observed.Proof), []byte("null")) {
		return fail("NOT_SUPPLIED", "尚未取得包含 H、H+1 和执行结果的完整原始证明。")
	}
	blockRaw, err := pqRawBlockProof(observed.Proof)
	if err != nil {
		return fail("BAD_PROOF", "交易证明未提供唯一、规范的原始 H 区块头证明。")
	}
	headerProof, err := consensus.DecodePQLightProofRequest(blockRaw)
	if err != nil {
		return fail("BAD_PROOF", "原 CORE 严格头证明解码器拒绝本次输入。")
	}
	localTrust := trust.Light
	localTrust.Now = now.UTC()
	// This supported verifier alone establishes the H header. Failure of the
	// later full two-header verifier retains only that actually proved layer.
	block, err := consensus.VerifyPQLightProof(localTrust, expected.Block, headerProof)
	if err != nil {
		return fail(pqReason(err), "原 CORE 独立 PQ 轻验未通过："+pqPublicError(err))
	}
	if !block.CommitVerified || !block.LightTransitionVerified {
		return fail("BAD_PROOF", "原 CORE 未返回已验证的完整 Commit 与轻验过渡。")
	}
	v.Level = HeaderVerified
	v.Height = fmt.Sprint(block.HeaderHeight)
	proof, err := consensus.DecodePQTransactionProofRequest(observed.Proof)
	if err != nil {
		return fail("BAD_PROOF", "已验证 H 区块头；原 CORE 严格解码器拒绝缺失或非规范的 H+1、交易包含或执行结果证明。")
	}
	verified, err := consensus.VerifyPQTransactionProof(localTrust, expected, proof)
	if err != nil {
		return fail(pqReason(err), "已验证 H 区块头；原 CORE 的 H+1、包含或确定性结果验证未通过："+pqPublicError(err))
	}
	if !verified.Included || !verified.Finalized || verified.NativeGrant || !samePQHash(verified.TransactionHash, expected.TransactionHash) || !samePQHash(verified.NativeWireHash, expected.NativeWireHash) {
		return fail("BAD_PROOF", "原 CORE 未返回绑定本次交易的包含和确定性结果证明。")
	}
	if trust.Member != nil {
		selected := *trust.Member
		found := false
		for _, member := range verified.BatchResults {
			if member.Index != selected {
				continue
			}
			found = true
			if member.Outcome == "admitted" {
				requested, decodeErr := hashBytes(txID)
				if decodeErr != nil || !samePQHash(member.TransactionHash, requested) {
					return fail("BAD_PROOF", "已认证结果中的批成员身份与本次请求不符。")
				}
			}
			v.SelectedMemberResultVerified = true
			v.SelectedMemberOutcome = member.Outcome
			break
		}
		// A rejection before Whole admission may have no per-member result. Keep
		// that distinction: the outer result authenticates no successful member.
		if !found && verified.Outcome != "rejected" {
			return fail("BAD_PROOF", "已认证的批结果缺少本次请求的成员。")
		}
	}
	v.Level = InclusionVerified
	v.ABCIResultVerified = true
	v.ExecutionOutcome = verified.Outcome
	v.ABCIExecutionCode = fmt.Sprint(verified.ExecutionCode)
	return fail("STATE_NOT_PROVEN", "已由原 CORE 验证 H 的交易包含与 H+1 承诺的确定性 ABCI 结果；这不证明账户、发票、资金状态或到账。")
}

func bindPQRequestedTransaction(txID string, trust *PQReceiptTrust) error {
	expected := trust.Expected
	if len(expected.Envelope) == 0 || len(expected.Envelope) > consensus.MaxPQContractTransactionBytes || len(expected.NativeWire) == 0 || len(expected.NativeWire) > chain.MaxPQBatchBytes || len(expected.TransactionHash) != 32 || len(expected.NativeWireHash) != 32 {
		return errors.New("missing bounded independent original bytes")
	}
	if !samePQHash(consensus.SignedTransactionHash(expected.Envelope), expected.TransactionHash) || !samePQHash(consensus.SignedTransactionHash(expected.NativeWire), expected.NativeWireHash) {
		return errors.New("independent hashes differ from original bytes")
	}
	var kind string
	var wire []byte
	var err error
	if expected.TransactionType == consensus.PQActionType {
		kind = consensus.PQActionType
		wire, _, err = consensus.DecodePQActionTransport(expected.Envelope)
	} else {
		var envelope consensus.PQTransaction
		envelope, wire, err = consensus.DecodePQTransaction(expected.Envelope)
		kind = envelope.Type
	}
	if err != nil || kind != expected.TransactionType || !bytes.Equal(wire, expected.NativeWire) {
		return errors.New("original canonical envelope/native mapping differs")
	}
	requested, err := hashBytes(txID)
	if err != nil {
		return err
	}
	if trust.Member == nil {
		if !bytes.Equal(requested, expected.TransactionHash) && !bytes.Equal(requested, expected.NativeWireHash) {
			return errors.New("requested transaction differs")
		}
		return nil
	}
	if kind != consensus.PQWholeType {
		return errors.New("selected batch member requires original Whole")
	}
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil || uint64(*trust.Member) >= uint64(len(whole.Messages)) {
		return errors.New("selected member not in original Whole")
	}
	memberHash, err := chain.PQBatchTransactionHash(consensus.SignedTransactionHash(wire), *trust.Member)
	if err != nil || !samePQHash(memberHash, requested) {
		return errors.New("requested batch member mapping differs")
	}
	return nil
}
func samePQHash(encoded string, expected []byte) bool {
	raw, err := hashBytes(encoded)
	return err == nil && len(expected) == 32 && bytes.Equal(raw, expected)
}
func pqReason(err error) string {
	var original *consensus.PQLightProofError
	if errors.As(err, &original) && original.Code == "expired_trust" {
		return "EXPIRED"
	}
	return "BAD_PROOF"
}
func pqPublicError(err error) string {
	var original *consensus.PQLightProofError
	if errors.As(err, &original) {
		return original.Code
	}
	return "proof_rejected"
}

func decodePQCollector(raw []byte) (pqCollector, error) {
	var out pqCollector
	if len(raw) == 0 || len(raw) > MaxPQNetworkReceiptBytes || !utf8.Valid(raw) {
		return out, errors.New("collector byte bound")
	}
	// Check the outer transport without normalizing duplicate fields. Nested
	// proof bytes remain unchanged for the original canonical proof decoder.
	dec := json.NewDecoder(bytes.NewReader(raw))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return out, errors.New("collector object required")
	}
	allowed := map[string]bool{"version": true, "source": true, "status": true, "observedExecutionStatus": true, "nativeTransactionHash": true, "abciTransactionHash": true, "executionHeight": true, "cometIndex": true, "independentFinality": true, "proofVerification": true, "proof": true, "error": true}
	fields := make(map[string]bool)
	for dec.More() {
		token, err = dec.Token()
		if err != nil {
			return out, err
		}
		name, ok := token.(string)
		if !ok || !allowed[name] || fields[name] || len(fields) >= len(allowed) {
			return out, errors.New("duplicate or excessive collector field")
		}
		fields[name] = true
		var value json.RawMessage
		if err = dec.Decode(&value); err != nil {
			return out, err
		}
	}
	if _, err = dec.Token(); err != nil {
		return out, err
	}
	if _, err = dec.Token(); err != io.EOF {
		return out, errors.New("trailing collector data")
	}
	for _, name := range []string{"version", "source", "status", "nativeTransactionHash", "executionHeight", "independentFinality", "proofVerification"} {
		if !fields[name] {
			return out, errors.New("missing required collector field")
		}
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if err = strict.Decode(&out); err != nil {
		return out, err
	}
	if out.Version != PQCollectorVersion || len(out.Source) > 2048 || len(out.Status) > 64 || len(out.ObservedExecutionStatus) > 64 || len(out.ProofVerification) > 128 || len(out.Error) > 4096 {
		return out, errors.New("unsupported collector version or metadata bound")
	}
	// Scalars in the original DTO are canonical JSON strings/bools, not null.
	var shape map[string]json.RawMessage
	if json.Unmarshal(raw, &shape) != nil {
		return out, errors.New("invalid collector shape")
	}
	for name, value := range shape {
		if name != "proof" && name != "cometIndex" && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return out, errors.New("null collector scalar")
		}
	}
	var canonicalHeight string
	if json.Unmarshal(shape["executionHeight"], &canonicalHeight) != nil || canonicalHeight != fmt.Sprint(out.ExecutionHeight) {
		return out, errors.New("noncanonical collector height")
	}
	return out, nil
}

// Extract the original raw block sub-object before requiring execution proof
// completeness. Only the original light decoder/verifier can establish H; a
// missing H+1 never fabricates inclusion and need not erase a genuine H proof.
func pqRawBlockProof(raw []byte) (json.RawMessage, error) {
	allowed := map[string]bool{"version": true, "block": true, "successor": true, "transactionProof": true, "executionResult": true, "executionProof": true}
	dec := json.NewDecoder(bytes.NewReader(raw))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return nil, errors.New("proof object required")
	}
	fields := make(map[string]json.RawMessage)
	for dec.More() {
		token, err = dec.Token()
		if err != nil {
			return nil, err
		}
		name, ok := token.(string)
		if !ok || !allowed[name] || fields[name] != nil {
			return nil, errors.New("duplicate or unknown original proof field")
		}
		var value json.RawMessage
		if err = dec.Decode(&value); err != nil {
			return nil, err
		}
		fields[name] = value
	}
	if _, err = dec.Token(); err != nil {
		return nil, err
	}
	if _, err = dec.Token(); err != io.EOF {
		return nil, errors.New("trailing proof data")
	}
	var version string
	if json.Unmarshal(fields["version"], &version) != nil || version != consensus.PQTransactionProofVersion || len(fields["block"]) == 0 {
		return nil, errors.New("original proof version or block missing")
	}
	return fields["block"], nil
}
