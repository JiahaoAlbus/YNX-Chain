package receipt

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/secp256k1"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/cometbft/cometbft/light"
	"github.com/cometbft/cometbft/types"
)

const (
	RPCOnly           = "RPC_ONLY"
	HeaderVerified    = "HEADER_VERIFIED"
	InclusionVerified = "INCLUSION_VERIFIED"
	StateVerified     = "STATE_VERIFIED"
	anchorVersion     = "cometbft-v0.38"
	maxClockDrift     = 10 * time.Second
	maxTrustWindow    = 14 * 24 * time.Hour
)

type ChainRef struct {
	Genesis string `json:"genesis"`
	ChainID string `json:"chainId"`
}

// AnchorDocument is public data. Its digest must arrive through an independently
// trusted channel, never through the RPC being checked. A source label alone is
// not authority. ImportTrustAnchor is an operator boundary, not a browser API.
type AnchorDocument struct {
	Version    string            `json:"version"`
	Chain      ChainRef          `json:"chain"`
	TrustUntil time.Time         `json:"trustUntil"`
	LightBlock *types.LightBlock `json:"lightBlock"`
}

// TrustAnchor's private fields prevent an RPC payload from constructing or
// changing a trusted anchor after it has been independently pinned.
type TrustAnchor struct {
	doc    AnchorDocument
	source string
	pin    string
}

type TrustSummary struct {
	Chain      ChainRef `json:"chain"`
	Height     string   `json:"height"`
	HeaderID   string   `json:"headerId"`
	TrustUntil string   `json:"trustUntil"`
	Source     string   `json:"source"`
	PinSHA256  string   `json:"pinSHA256"`
}

func (a *TrustAnchor) Summary() TrustSummary {
	if a == nil {
		return TrustSummary{}
	}
	return TrustSummary{a.doc.Chain, fmt.Sprint(a.doc.LightBlock.Height),
		hex.EncodeToString(a.doc.LightBlock.Hash()), a.doc.TrustUntil.UTC().Format(time.RFC3339Nano), a.source, a.pin}
}

// ImportTrustAnchor binds a public checkpoint to a digest supplied separately by
// the local operator. It also checks the genuine Comet signatures and voting
// power; these checks do not make a self-signed RPC checkpoint independently
// trusted. The helper must keep this function outside its HTTP input surface.
func ImportTrustAnchor(raw []byte, pinSHA256, independentSource string, now time.Time) (out *TrustAnchor, err error) {
	defer func() {
		if recover() != nil {
			out, err = nil, errors.New("malformed checkpoint rejected")
		}
	}()
	pin, err := hashBytes(pinSHA256)
	if err != nil || strings.TrimSpace(independentSource) == "" {
		return nil, errors.New("independent checkpoint digest and source are required")
	}
	actual := sha256.Sum256(raw)
	if !bytes.Equal(pin, actual[:]) {
		return nil, errors.New("checkpoint does not match independent digest")
	}
	var doc AnchorDocument
	if err := cmtjson.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("checkpoint encoding: %w", err)
	}
	if doc.Version != anchorVersion {
		return nil, errors.New("unsupported checkpoint consensus format; no PQ compatibility implied")
	}
	if _, err := hashBytes(doc.Chain.Genesis); err != nil || doc.Chain.ChainID == "" {
		return nil, errors.New("checkpoint must bind genesis digest and Comet chain ID")
	}
	if doc.LightBlock == nil || doc.LightBlock.SignedHeader == nil || doc.LightBlock.Header == nil || doc.LightBlock.Commit == nil || doc.LightBlock.ValidatorSet == nil {
		return nil, errors.New("checkpoint header, commit and validator set are required")
	}
	if err := validateValidatorShape(doc.LightBlock.ValidatorSet); err != nil {
		return nil, fmt.Errorf("checkpoint validators: %w", err)
	}
	if err := doc.LightBlock.ValidateBasic(doc.Chain.ChainID); err != nil {
		return nil, fmt.Errorf("checkpoint: %w", err)
	}
	if !now.Before(doc.TrustUntil) || !doc.TrustUntil.After(doc.LightBlock.Time) || doc.TrustUntil.Sub(doc.LightBlock.Time) > maxTrustWindow {
		return nil, errors.New("checkpoint expired or exceeds the 14-day local trust limit")
	}
	if !doc.LightBlock.Time.Before(now.Add(maxClockDrift)) {
		return nil, errors.New("checkpoint timestamp is in the future")
	}
	if err := verifyCommit(doc.LightBlock); err != nil {
		return nil, fmt.Errorf("checkpoint commit: %w", err)
	}
	doc.Chain.Genesis = strings.ToLower(strings.TrimPrefix(doc.Chain.Genesis, "0x"))
	return &TrustAnchor{doc: doc, source: strings.TrimSpace(independentSource), pin: hex.EncodeToString(actual[:])}, nil
}

// ChainProof contains untrusted inputs. StateProof is retained for reporting;
// the current canonical Application.Query does not emit a verifiable member
// state proof. No caller-selected root, events, code=0 or JSON boolean can
// promote a receipt to StateVerified.
type ChainProof struct {
	Source     string            `json:"source"`
	Chain      ChainRef          `json:"chain"`
	Height     string            `json:"height"`
	Header     *types.LightBlock `json:"header,omitempty"`
	Inclusion  *types.TxProof    `json:"inclusion,omitempty"`
	TxIndex    string            `json:"txIndex,omitempty"`
	Member     string            `json:"member,omitempty"`
	Event      string            `json:"event,omitempty"`
	StateProof json.RawMessage   `json:"stateProof,omitempty"`
}

type ProofView struct {
	Level             string `json:"level"`
	TxID              string `json:"txId"`
	Height            string `json:"height"`
	Source            string `json:"source"`
	Reason            string `json:"reason,omitempty"`
	Detail            string `json:"detail"`
	RequestedMember   string `json:"requestedMember,omitempty"`
	RequestedEvent    string `json:"requestedEvent,omitempty"`
	MemberVerified    bool   `json:"memberVerified"`
	ExecutionVerified bool   `json:"executionVerified"`
}

// VerifyNetworkReceipt authenticates each layer in order with the existing
// pinned CometBFT implementation. A failure retains only previously proved
// layers. This verifies the outer transaction, never an inner batch member's
// success or a transfer's amount, recipient, balance or execution status.
func VerifyNetworkReceipt(txID string, anchor *TrustAnchor, proof ChainProof, now time.Time) (result ProofView) {
	v := ProofView{Level: RPCOnly, TxID: txID, Height: proof.Height, Source: proof.Source,
		RequestedMember: proof.Member, RequestedEvent: proof.Event}
	defer func() {
		if recover() != nil {
			v.Reason, v.Detail = "BAD_PROOF", "畸形证明已拒绝，未取得更高验证等级。"
			result = v
		}
	}()
	fail := func(reason, detail string) ProofView { v.Reason, v.Detail = reason, detail; return v }
	wanted, err := hashBytes(txID)
	if err != nil {
		return fail("INVALID", "交易标识必须是 32 字节十六进制摘要。")
	}
	if anchor == nil {
		return fail("NOT_SUPPLIED", "仅 RPC 返回：尚未导入来自独立可信渠道的检查点。")
	}
	if !now.Before(anchor.doc.TrustUntil) {
		return fail("EXPIRED", "检查点已过信任期，不能独立验证本次结果。")
	}
	if proof.Header == nil {
		return fail("NOT_SUPPLIED", "仅 RPC 返回：未提供区块头、Commit 和完整验证者集合。")
	}
	genesis, err := hashBytes(proof.Chain.Genesis)
	trustedGenesis, _ := hashBytes(anchor.doc.Chain.Genesis)
	if err != nil || !bytes.Equal(genesis, trustedGenesis) || proof.Chain.ChainID != anchor.doc.Chain.ChainID {
		return fail("BAD_PROOF", "证明的创世摘要或链标识与独立检查点不符。")
	}
	lb := proof.Header
	if lb.SignedHeader == nil || lb.Header == nil || lb.Commit == nil || lb.ValidatorSet == nil {
		return fail("BAD_PROOF", "区块头、Commit 或验证者集合不完整。")
	}
	if proof.Height != fmt.Sprint(lb.Height) {
		return fail("BAD_PROOF", "请求的执行高度与包含交易的区块头高度不符。")
	}
	if err := validateValidatorShape(lb.ValidatorSet); err != nil {
		return fail("BAD_PROOF", "验证者集合格式或权重无效："+err.Error())
	}
	if err := lb.ValidateBasic(anchor.doc.Chain.ChainID); err != nil {
		return fail("BAD_PROOF", "区块头或验证者集合校验失败："+err.Error())
	}
	trusted := anchor.doc.LightBlock
	if lb.Height == trusted.Height {
		if !bytes.Equal(lb.Hash(), trusted.Hash()) {
			return fail("BAD_PROOF", "同高度区块头与独立检查点不符。")
		}
		if err := verifyCommit(lb); err != nil {
			return fail("BAD_PROOF", "Commit 验签或投票权不足："+err.Error())
		}
	} else {
		if err := light.Verify(trusted.SignedHeader, trusted.ValidatorSet, lb.SignedHeader, lb.ValidatorSet,
			anchor.doc.TrustUntil.Sub(trusted.Time), now, maxClockDrift, cmtmath.Fraction{Numerator: 1, Denominator: 3}); err != nil {
			return fail("BAD_PROOF", "独立轻验失败："+err.Error())
		}
	}
	v.Level = HeaderVerified
	if proof.Inclusion == nil {
		return fail("NOT_SUPPLIED", "已验证区块头与 Commit；尚未证明该交易包含。")
	}
	if !bytes.Equal(wanted, proof.Inclusion.Data.Hash()) {
		return fail("BAD_PROOF", "包含证明对应另一笔交易，不能用于本次请求。")
	}
	if proof.TxIndex != "" && proof.TxIndex != fmt.Sprint(proof.Inclusion.Proof.Index) {
		return fail("BAD_PROOF", "交易位置与包含证明索引不符。")
	}
	if err := proof.Inclusion.Validate(lb.DataHash); err != nil {
		return fail("BAD_PROOF", "交易包含证明与已验证头的数据根不符："+err.Error())
	}
	v.Level = InclusionVerified
	return fail("UNSUPPORTED", "已验证外层交易包含。当前链未提供可认证的成员/执行状态证明，资金到账与成员成功尚未验证。")
}

func verifyCommit(lb *types.LightBlock) error {
	return lb.ValidatorSet.VerifyCommitLight(lb.ChainID, lb.Commit.BlockID, lb.Height, lb.Commit)
}

// Comet's in-process types assume well-formed key lengths and bounded weight.
// Preflight external JSON before calling methods which may otherwise panic.
func validateValidatorShape(vals *types.ValidatorSet) error {
	if vals == nil || vals.Proposer == nil || len(vals.Validators) == 0 || len(vals.Validators) > types.MaxVotesCount {
		return errors.New("missing or oversized validator set")
	}
	checkKey := func(v *types.Validator) error {
		if v == nil || v.PubKey == nil {
			return errors.New("missing validator key")
		}
		switch key := v.PubKey.(type) {
		case ed25519.PubKey:
			if len(key) != ed25519.PubKeySize {
				return errors.New("invalid Ed25519 key length")
			}
		case secp256k1.PubKey:
			if len(key) != secp256k1.PubKeySize {
				return errors.New("invalid secp256k1 key length")
			}
		default:
			return errors.New("unsupported consensus key type")
		}
		return nil
	}
	if err := checkKey(vals.Proposer); err != nil {
		return err
	}
	seen := make(map[string]bool, len(vals.Validators))
	var sum int64
	for _, v := range vals.Validators {
		if err := checkKey(v); err != nil {
			return err
		}
		if v.VotingPower <= 0 || v.VotingPower > types.MaxTotalVotingPower-sum {
			return errors.New("voting power out of bounds")
		}
		sum += v.VotingPower
		if seen[string(v.Address)] {
			return errors.New("duplicate validator")
		}
		seen[string(v.Address)] = true
	}
	power, err := vals.TotalVotingPowerSafe()
	if err != nil || power != sum {
		return errors.New("invalid total voting power")
	}
	return nil
}

func hashBytes(value string) ([]byte, error) {
	value = strings.TrimPrefix(value, "0x")
	if len(value) != 64 {
		return nil, errors.New("expected 32-byte digest")
	}
	return hex.DecodeString(value)
}
