package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

// LegacyTrustSource retains the source records under their original IDs and
// hash domains. Records never acquire fabricated Signer/TxHash/BlockHeight
// fields. Updates contain only actual, newly signed application transactions.
// The owning state must commit this whole value, including Updates, in AppHash.
type LegacyTrustSource struct {
	SourceAnchor  string                    `json:"sourceAnchor"`
	SourceHeight  int64                     `json:"sourceHeight"`
	SourceChainID int64                     `json:"sourceChainId"`
	Records       LegacyTrustRecords        `json:"records"`
	Updates       []LegacyTrustSourceUpdate `json:"updates,omitempty"`
}

type LegacyTrustRecords struct {
	RiskLabels   map[string][]chain.RiskLabel          `json:"riskLabels"`
	Evidence     map[string]chain.EvidencePacket       `json:"evidencePackets"`
	Governance   map[string]chain.GovernanceRequest    `json:"governanceRequests"`
	Appeals      map[string]chain.TrustAppeal          `json:"trustAppeals"`
	Tracking     map[string]chain.TrackingPolicyReview `json:"trackingPolicyReviews"`
	Transparency map[string]chain.TransparencyEntry    `json:"transparencyEntries"`
}

type LegacyTrustSourceUpdate struct {
	Transaction       []byte    `json:"transaction"`
	Height            int64     `json:"height"`
	Time              time.Time `json:"time"`
	TransactionHash   string    `json:"transactionHash"`
	RecordID          string    `json:"recordId"`
	PreviousAuditHash string    `json:"previousAuditHash"`
	AuditHash         string    `json:"auditHash"`
}

func originalTrustRecords(m chain.ConsensusMigrationState) LegacyTrustRecords {
	if m.Runtime == nil {
		return LegacyTrustRecords{}
	}
	r := m.Runtime
	return LegacyTrustRecords{r.RiskLabels, r.Evidence, r.Governance, r.Appeals, r.Tracking, r.Transp}
}

// The constructor/CommittedState.Validate caller must first authenticate the
// complete migration. Do not rehash its potentially large runtime per module.
func migrationTrustSource(m chain.ConsensusMigrationState) (*LegacyTrustSource, error) {
	if m.Runtime == nil {
		return nil, errors.New("Trust import requires complete source runtime")
	}
	r := originalTrustRecords(m)
	if len(r.RiskLabels)+len(r.Evidence)+len(r.Governance)+len(r.Appeals)+len(r.Tracking)+len(r.Transparency) == 0 {
		return nil, nil
	}
	if err := validateOriginalTrustRecords(r); err != nil {
		return nil, err
	}
	return cloneLegacyTrustSource(&LegacyTrustSource{SourceAnchor: m.StateHash, SourceHeight: int64(m.Height), SourceChainID: m.Network.ChainID, Records: r}), nil
}

func cloneLegacyTrustSource(s *LegacyTrustSource) *LegacyTrustSource {
	if s == nil {
		return nil
	}
	// A JSON round trip would collapse empty omitempty slices inside evidence
	// transactions. Preserve every concrete source value and detach mutable data.
	return cloneLegacyTrustValue(reflect.ValueOf(s)).Interface().(*LegacyTrustSource)
}

func cloneLegacyTrustValue(v reflect.Value) reflect.Value {
	if v.Type() == reflect.TypeOf(time.Time{}) {
		return v
	}
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
		out := reflect.New(v.Type().Elem())
		out.Elem().Set(cloneLegacyTrustValue(v.Elem()))
		return out
	case reflect.Slice:
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
		out := reflect.MakeSlice(v.Type(), v.Len(), v.Len())
		for i := 0; i < v.Len(); i++ {
			out.Index(i).Set(cloneLegacyTrustValue(v.Index(i)))
		}
		return out
	case reflect.Map:
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
		out := reflect.MakeMapWithSize(v.Type(), v.Len())
		iter := v.MapRange()
		for iter.Next() {
			out.SetMapIndex(iter.Key(), cloneLegacyTrustValue(iter.Value()))
		}
		return out
	case reflect.Struct:
		out := reflect.New(v.Type()).Elem()
		out.Set(v)
		for i := 0; i < v.NumField(); i++ {
			out.Field(i).Set(cloneLegacyTrustValue(v.Field(i)))
		}
		return out
	default:
		return v
	}
}

// This is the original Devnet hashParts algorithm, not a BFT audit hash.
func legacyTrustHash(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func legacyTrustEvidenceHash(packet chain.EvidencePacket) (string, error) {
	packet.JSONHash = ""
	raw, err := json.Marshal(packet)
	if err != nil {
		return "", err
	}
	return legacyTrustHash("evidence-json", string(raw)), nil
}

func validateOriginalTrustRecords(r LegacyTrustRecords) error {
	labels := map[string]chain.RiskLabel{}
	for subject, values := range r.RiskLabels {
		for _, v := range values {
			if !trustRecordIDPattern.MatchString(v.ID) || v.Subject != subject || strings.TrimSpace(subject) == "" || v.Label == "" || v.Source == "" || v.EvidenceHash == "" || v.CreatedAt.IsZero() || v.UpdatedAt.Before(v.CreatedAt) || v.RiskWeightBps < 0 || v.RiskWeightBps > 10000 || v.ConfidenceBps < 0 || v.ConfidenceBps > 10000 || !v.AppealAvailable || v.AssetEffect != "none_advisory_only" {
				return fmt.Errorf("source Trust label %q lacks its original advisory fields", v.ID)
			}
			if _, exists := labels[v.ID]; exists {
				return errors.New("duplicate source Trust label ID")
			}
			labels[v.ID] = v
		}
	}
	for id, v := range r.Evidence {
		hash, err := legacyTrustEvidenceHash(v)
		if id != v.ID || !trustRecordIDPattern.MatchString(id) || v.Subject == "" || v.GeneratedAt.IsZero() || err != nil || hash != v.JSONHash {
			return fmt.Errorf("source evidence %q lacks its exact original evidence-json bytes/hash", id)
		}
	}
	for id, v := range r.Transparency {
		if id != v.ID || !trustRecordIDPattern.MatchString(id) || v.Type == "" || v.Status == "" || v.CreatedAt.IsZero() {
			return fmt.Errorf("source transparency %q is incomplete", id)
		}
	}
	checkEntry := func(id, subject, request, appeal string) error {
		v, ok := r.Transparency[id]
		if !ok || v.Subject != subject || v.RequestID != request || v.AppealID != appeal {
			return fmt.Errorf("source Trust object lost original transparency relation %q", id)
		}
		return nil
	}
	for id, v := range r.Governance {
		if id != v.ID || !trustRecordIDPattern.MatchString(id) || v.Requester == "" || v.Subject == "" || v.Action == "" || v.Status == "" || v.CreatedAt.IsZero() || !v.RequiresAppeal || nativeYNXTAsset(v.AssetType) && !v.NativeYNXTProtected {
			return fmt.Errorf("source governance %q lacks its original identity/protection", id)
		}
		if err := checkEntry(v.TransparencyEntryID, v.Subject, id, ""); err != nil {
			return err
		}
	}
	for id, v := range r.Appeals {
		if id != v.ID || !trustRecordIDPattern.MatchString(id) || v.Subject == "" || v.Appellant == "" || v.Claimant == "" || v.Reason == "" || v.Status == "" || v.CreatedAt.IsZero() || v.UpdatedAt.Before(v.CreatedAt) || v.RequestID == "" && v.LabelID == "" {
			return fmt.Errorf("source appeal %q is incomplete", id)
		}
		// Source allowed both references. Preserve and check both; do not apply
		// the newer single-reference payload rule retrospectively.
		if v.RequestID != "" {
			request, ok := r.Governance[v.RequestID]
			if !ok || request.Subject != v.Subject {
				return errors.New("source appeal governance relation is missing")
			}
		}
		if v.LabelID != "" {
			label, ok := labels[v.LabelID]
			if !ok || label.Subject != v.Subject {
				return errors.New("source appeal label relation is missing")
			}
		}
		if err := checkEntry(v.TransparencyEntryID, v.Subject, v.RequestID, id); err != nil {
			return err
		}
	}
	for id, v := range r.Tracking {
		if id != v.ID || !trustRecordIDPattern.MatchString(id) || v.Requester == "" || v.Subject == "" || v.Purpose == "" || v.QueryType == "" || v.Status == "" || v.CreatedAt.IsZero() || v.AppealPath != "/trust/appeals" {
			return fmt.Errorf("source tracking review %q is incomplete", id)
		}
		if err := checkEntry(v.TransparencyEntryID, v.Subject, id, ""); err != nil {
			return err
		}
	}
	return nil
}

func legacyTrustUpdateHash(update LegacyTrustSourceUpdate) string {
	update.AuditHash = ""
	return recordAuditHash("YNX_SOURCE_TRUST_CONTINUATION_V1", update)
}

func validateLegacyTrustSourceContinuation(previous, next *LegacyTrustSource) error {
	if previous == nil {
		return nil // Initial import still requires validateLegacyTrustSource.
	}
	if next == nil || previous.SourceAnchor != next.SourceAnchor || previous.SourceHeight != next.SourceHeight || previous.SourceChainID != next.SourceChainID || !reflect.DeepEqual(previous.Records, next.Records) || len(next.Updates) < len(previous.Updates) {
		return errors.New("source Trust history cannot be replaced or truncated")
	}
	for i, event := range previous.Updates {
		if !reflect.DeepEqual(event, next.Updates[i]) {
			return errors.New("source Trust continuation history cannot be rewritten")
		}
	}
	return nil
}

// Replays the source segment plus real post-cutover operations. Historical
// source strings identify records; they never authorize any signer.
func replayLegacyTrustSource(source *LegacyTrustSource, m chain.ConsensusMigrationState, policyState CommittedState) (LegacyTrustRecords, error) {
	if source == nil {
		return LegacyTrustRecords{}, nil
	}
	if source.SourceAnchor != m.StateHash || source.SourceHeight != int64(m.Height) || source.SourceChainID != m.Network.ChainID || !reflect.DeepEqual(source.Records, originalTrustRecords(m)) {
		return LegacyTrustRecords{}, errors.New("source Trust segment differs from the pinned complete migration")
	}
	if err := validateOriginalTrustRecords(source.Records); err != nil {
		return LegacyTrustRecords{}, err
	}
	nonces := map[string]uint64{}
	for _, account := range m.Accounts {
		nonces[account.Address] = account.Nonce
	}
	return replayValidatedLegacyTrustSource(source, policyState, nonces)
}

// The parent query passes an already validated immutable committed source. No
// anchor supplied in a request can enter this path or grant signing authority.
func replayValidatedLegacyTrustSource(source *LegacyTrustSource, policyState CommittedState, nonces map[string]uint64) (LegacyTrustRecords, error) {
	if source == nil {
		return LegacyTrustRecords{}, nil
	}
	view := cloneLegacyTrustSource(source).Records
	previous, previousHeight := "", source.SourceHeight
	seen := map[string]bool{}
	if nonces == nil {
		nonces = map[string]uint64{}
	}
	for _, event := range source.Updates {
		if event.Height <= source.SourceHeight || event.Height < previousHeight || event.Height > policyState.Height || event.Time.IsZero() || event.Time.Location() != time.UTC || event.PreviousAuditHash != previous || event.AuditHash != legacyTrustUpdateHash(event) || event.TransactionHash != ApplicationActionHash(event.Transaction) || seen[event.TransactionHash] {
			return LegacyTrustRecords{}, errors.New("invalid original source Trust continuation order/hash/height")
		}
		tx, err := DecodeSignedApplicationAction(event.Transaction)
		if err != nil {
			return LegacyTrustRecords{}, err
		}
		if err = tx.Verify(source.SourceChainID); err != nil {
			return LegacyTrustRecords{}, err
		}
		if err = requireConsensusLegacy(policyState.AccountPolicy, tx.Signer, event.Height); err != nil {
			return LegacyTrustRecords{}, err
		}
		if tx.Nonce <= nonces[tx.Signer] {
			return LegacyTrustRecords{}, errors.New("source Trust continuation reuses signer nonce")
		}
		id, handled, err := applyLegacyTrustRecord(&view, tx, event.TransactionHash, event.Height, event.Time)
		if err != nil || !handled || id != event.RecordID {
			return LegacyTrustRecords{}, errors.New("source Trust continuation differs from signed business operation")
		}
		previous, previousHeight = event.AuditHash, event.Height
		seen[event.TransactionHash], nonces[tx.Signer] = true, tx.Nonce
	}
	return view, nil
}

func validateLegacyTrustSource(source *LegacyTrustSource, state CommittedState, m chain.ConsensusMigrationState) error {
	if source == nil {
		r := originalTrustRecords(m)
		if len(r.RiskLabels)+len(r.Evidence)+len(r.Governance)+len(r.Appeals)+len(r.Tracking)+len(r.Transparency) != 0 {
			return errors.New("committed state omitted source Trust records")
		}
		return nil
	}
	if state.Version < 18 {
		return errors.New("legacy Trust source requires committed schema 18 or later")
	}
	view, err := replayLegacyTrustSource(source, m, state)
	if err != nil {
		return err
	}
	for _, v := range state.GovernanceRequests {
		if _, ok := view.Governance[v.ID]; ok {
			return errors.New("BFT governance shadows original source record")
		}
	}
	for _, v := range state.TrustAppeals {
		if _, ok := view.Appeals[v.ID]; ok {
			return errors.New("BFT appeal shadows original source record")
		}
	}
	originalLabels := make(map[string]chain.RiskLabel)
	for _, labels := range source.Records.RiskLabels {
		for _, label := range labels {
			originalLabels[label.ID] = label
		}
	}
	for _, v := range state.TrustEvidence {
		if _, ok := view.Evidence[v.ID]; ok {
			return errors.New("BFT evidence shadows original source record")
		}
		// Source labels are immutable and current source updates only add
		// appeals. Every newly generated packet must retain each original
		// subject label exactly once, independent of its self-reported hashes.
		// Do not compare newer BFT labels to this historical packet snapshot.
		counts := make(map[string]int)
		for _, label := range v.Labels {
			if original, ok := originalLabels[label.ID]; ok {
				if original.Subject != v.Subject || !reflect.DeepEqual(label, original) {
					return errors.New("BFT evidence changed an immutable source Trust label")
				}
				counts[label.ID]++
			}
		}
		for _, original := range source.Records.RiskLabels[v.Subject] {
			if counts[original.ID] != 1 {
				return errors.New("BFT evidence must contain each original source Trust label exactly once")
			}
		}
		if !reflect.DeepEqual(v.RiskSummary, chain.TrustRiskSummaryForLabels(v.Subject, v.Labels, v.GeneratedAt)) {
			return errors.New("BFT evidence risk summary differs from its original packet labels and time")
		}
	}
	for _, v := range state.TrackingReviews {
		if _, ok := view.Tracking[v.ID]; ok {
			return errors.New("BFT tracking review shadows original source record")
		}
	}
	for _, v := range state.Transparency {
		if _, ok := view.Transparency[v.ID]; ok {
			return errors.New("BFT transparency shadows original source entry")
		}
	}
	for _, v := range state.TrustLabels {
		for _, labels := range view.RiskLabels {
			for _, old := range labels {
				if old.ID == v.ID {
					return errors.New("BFT label shadows original source record")
				}
			}
		}
	}
	updatesByHash := make(map[string]bool, len(source.Updates))
	for _, update := range source.Updates {
		updatesByHash[update.TransactionHash] = true
		tx, _ := DecodeSignedApplicationAction(update.Transaction)
		i, exists := accountIndex(state.Accounts, tx.Signer)
		if !exists || state.Accounts[i].Nonce < tx.Nonce {
			return errors.New("source Trust continuation nonce was not consumed")
		}
		count := 0
		for _, fee := range state.FeeEvents {
			if fee.TxHash == update.TransactionHash {
				count++
				recipient := ""
				for _, v := range m.Validators {
					if v.Active {
						recipient = v.Address
						break
					}
				}
				if fee != newCurrentFeeEvent(update.TransactionHash, tx.Action, tx.Signer, recipient, tx.Fee, update.Height, update.Time) {
					return errors.New("source Trust continuation fee differs from actual execution")
				}
			}
		}
		if count != 1 {
			return errors.New("source Trust continuation requires its unique actual fee event")
		}
	}
	// Reverse coverage catches deleting the new source journal while retaining
	// its execution fee. Ordinary BFT appeals have their original creation
	// transparency entry even after a later resolution changes the appeal TxHash.
	for _, fee := range state.FeeEvents {
		if fee.TransactionType != ActionTrustAppealCreate || updatesByHash[fee.TxHash] {
			continue
		}
		found := false
		for _, entry := range state.Transparency {
			if entry.Type == "trust_appeal" && entry.TxHash == fee.TxHash {
				found = true
				break
			}
		}
		if !found {
			return errors.New("Trust appeal fee has neither its source signed original nor BFT creation record")
		}
	}
	// Source history is immutable; new charges must at least remain present in
	// the complete account counters. Other real transactions may add usage too.
	usage := map[string]int64{}
	for _, event := range source.Updates {
		tx, _ := DecodeSignedApplicationAction(event.Transaction)
		usage[tx.Signer]++
	}
	for signer, count := range usage {
		index, _ := accountIndex(state.Accounts, signer)
		var bandwidth, trust int64
		for _, original := range m.Accounts {
			if original.Address == signer {
				bandwidth, trust = original.ResourceUsage.BandwidthUsed, original.ResourceUsage.TrustUsed
				break
			}
		}
		current := state.Accounts[index].ResourceUsage
		if current.BandwidthUsed < bandwidth || current.TrustUsed < trust || current.BandwidthUsed-bandwidth < count || current.TrustUsed-trust < count {
			return errors.New("source Trust continuation resource charges were omitted")
		}
	}
	return nil
}

// The normal signed-action branch calls this before applyTrustAction. A false
// handled result leaves the original BFT path responsible for the transaction.
// The caller appends its existing fee event and commits nextSource atomically
// with nextState; this helper does not persist or publish a candidate itself.
func (a *Application) applyLegacyTrustSourceAction(state executionState, source *LegacyTrustSource, raw []byte, height int64, at time.Time) (executionState, *LegacyTrustSource, transactionExecution, bool, error) {
	if source == nil {
		return state, source, transactionExecution{}, false, nil
	}
	fail := func(err error) (executionState, *LegacyTrustSource, transactionExecution, bool, error) {
		return executionState{}, nil, transactionExecution{}, true, invalidTransaction(CodeInvalidTx, err)
	}
	tx, err := DecodeSignedApplicationAction(raw)
	if err != nil {
		return fail(err)
	}
	if !isTrustAction(tx.Action) {
		return state, source, transactionExecution{}, false, nil
	}
	if err = tx.Verify(a.migration.Network.ChainID); err != nil {
		return fail(err)
	}
	if height <= int64(a.migration.Height) {
		return fail(errors.New("source Trust update must follow cutover"))
	}
	if err = requireConsensusLegacy(state.accountPolicy, tx.Signer, height); err != nil {
		return fail(err)
	}
	view, err := replayLegacyTrustSource(source, a.migration, CommittedState{Height: height, AccountPolicy: state.accountPolicy})
	if err != nil {
		return fail(err)
	}
	if at.IsZero() {
		at = time.Unix(height, 0).UTC()
	}
	at = at.UTC()
	hash := ApplicationActionHash(raw)
	id, handled, err := applyLegacyTrustRecord(&view, tx, hash, height, at)
	if !handled {
		return state, source, transactionExecution{}, false, err
	}
	if err != nil {
		return fail(err)
	}
	for _, old := range source.Updates {
		if old.TransactionHash == hash {
			return fail(errors.New("source Trust original already executed"))
		}
	}
	next := a.cloneTransactionState(state)
	if err = a.chargeApplicationAction(&next, tx); err != nil {
		return fail(err)
	}
	copy := cloneLegacyTrustSource(source)
	previous := ""
	if len(copy.Updates) > 0 {
		previous = copy.Updates[len(copy.Updates)-1].AuditHash
	}
	update := LegacyTrustSourceUpdate{Transaction: bytes.Clone(raw), Height: height, Time: at, TransactionHash: hash, RecordID: id, PreviousAuditHash: previous}
	update.AuditHash = legacyTrustUpdateHash(update)
	copy.Updates = append(copy.Updates, update)
	executed := transactionExecution{typeName: tx.Type, event: abci.Event{Type: "ynx.source_trust_action", Attributes: []abci.EventAttribute{{Key: "source_anchor", Value: source.SourceAnchor}, {Key: "record_id", Value: id, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}}}}
	return next, copy, executed, true, nil
}
