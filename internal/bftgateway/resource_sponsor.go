package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handleResourceSponsorMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/json is required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "signed Resource sponsor action exceeds maximum size"})
		return
	}
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	objectID, expected, err := resourceSponsorRouteIdentity(r, tx)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	idemKey, err := resourceSponsorIdempotencyKey(tx)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	var replay consensus.BFTResourceSponsorIdempotency
	replayID := consensus.ResourceSponsorIdempotencyID(tx.Signer, idemKey)
	if err := g.queryABCIJSON(r.Context(), "/resource/sponsor-idempotency/"+replayID, &replay); err == nil {
		if replay.Action != tx.Action || replay.RequestHash != tx.PayloadHash {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Resource sponsor idempotency key is already committed for different input"})
			return
		}
		if replay.PoolSnapshot != nil {
			transaction, err := g.transactionAtHeight(r.Context(), replay.TxHash, uint64(replay.PoolSnapshot.BlockHeight))
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"pool": replay.PoolSnapshot, "transaction": transaction})
			return
		}
		if replay.SponsorshipSnapshot != nil {
			transaction, err := g.transactionAtHeight(r.Context(), replay.TxHash, uint64(replay.SponsorshipSnapshot.BlockHeight))
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"sponsorship": replay.SponsorshipSnapshot, "transaction": transaction})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource sponsor replay snapshot is unavailable"})
		return
	}
	transaction, err := g.broadcastApplicationAction(r.Context(), raw, tx)
	if err != nil {
		var txErr *gatewayTransactionError
		if errors.As(err, &txErr) {
			writeJSON(w, txErr.status, map[string]string{"error": txErr.Error()})
		} else {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		}
		return
	}
	if expected == "pool" {
		var record consensus.BFTResourcePool
		if err := g.queryABCIJSON(r.Context(), "/resource/pools/"+objectID, &record); err != nil || record.ID != objectID || record.Owner != tx.Signer || record.TxHash != transaction.Hash || record.LastAction != tx.Action {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource pool evidence mismatch"})
			return
		}
		status := http.StatusOK
		if tx.Action == consensus.ActionResourcePoolCreate {
			status = http.StatusCreated
		}
		writeJSON(w, status, map[string]any{"pool": record, "transaction": transaction})
		return
	}
	var record consensus.BFTResourceSponsorship
	if err := g.queryABCIJSON(r.Context(), "/resource/sponsorships/"+objectID, &record); err != nil || record.ID != objectID || record.Beneficiary != tx.Signer || record.TxHash != transaction.Hash {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource sponsorship evidence mismatch"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sponsorship": record, "transaction": transaction})
}

func resourceSponsorRouteIdentity(r *http.Request, tx consensus.SignedApplicationAction) (string, string, error) {
	pathID := strings.TrimSpace(r.PathValue("id"))
	switch tx.Action {
	case consensus.ActionResourcePoolCreate:
		if r.URL.Path != "/resource-market/pools" {
			return "", "", errors.New("signed Resource pool create action does not match requested route")
		}
		return "rsp_" + consensus.ApplicationActionRecordID("resource-pool", consensus.ApplicationActionHash(mustEncodeAction(tx))), "pool", nil
	case consensus.ActionResourcePoolFund:
		var p consensus.ResourcePoolFundPayload
		if decodeActionPayload(tx, &p) != nil || pathID == "" || p.PoolID != pathID || !strings.HasSuffix(r.URL.Path, "/fund") {
			return "", "", errors.New("signed Resource pool funding action does not match path")
		}
		return p.PoolID, "pool", nil
	case consensus.ActionResourcePoolPolicy:
		var p consensus.ResourcePoolPolicyPayload
		if decodeActionPayload(tx, &p) != nil || pathID == "" || p.PoolID != pathID || !strings.HasSuffix(r.URL.Path, "/policy") {
			return "", "", errors.New("signed Resource pool policy action does not match path")
		}
		return p.PoolID, "pool", nil
	case consensus.ActionResourcePoolStatus:
		var p consensus.ResourcePoolStatusPayload
		if decodeActionPayload(tx, &p) != nil || pathID == "" || p.PoolID != pathID || !strings.HasSuffix(r.URL.Path, "/status") {
			return "", "", errors.New("signed Resource pool status action does not match path")
		}
		return p.PoolID, "pool", nil
	case consensus.ActionResourceSponsor:
		if r.URL.Path != "/resource-market/sponsorships" {
			return "", "", errors.New("signed Resource sponsorship action does not match requested route")
		}
		return "rss_" + consensus.ApplicationActionRecordID("resource-sponsorship", consensus.ApplicationActionHash(mustEncodeAction(tx))), "sponsorship", nil
	default:
		return "", "", errors.New("signed action is not a Resource sponsor action")
	}
}

func mustEncodeAction(tx consensus.SignedApplicationAction) []byte {
	raw, _ := consensus.EncodeSignedApplicationAction(tx)
	return raw
}
func decodeActionPayload(tx consensus.SignedApplicationAction, out any) error {
	return json.Unmarshal(tx.Payload, out)
}

func resourceSponsorIdempotencyKey(tx consensus.SignedApplicationAction) (string, error) {
	switch tx.Action {
	case consensus.ActionResourcePoolCreate:
		var p consensus.ResourcePoolCreatePayload
		if err := decodeActionPayload(tx, &p); err != nil {
			return "", err
		}
		return p.IdempotencyKey, nil
	case consensus.ActionResourcePoolFund:
		var p consensus.ResourcePoolFundPayload
		if err := decodeActionPayload(tx, &p); err != nil {
			return "", err
		}
		return p.IdempotencyKey, nil
	case consensus.ActionResourcePoolPolicy:
		var p consensus.ResourcePoolPolicyPayload
		if err := decodeActionPayload(tx, &p); err != nil {
			return "", err
		}
		return p.IdempotencyKey, nil
	case consensus.ActionResourcePoolStatus:
		var p consensus.ResourcePoolStatusPayload
		if err := decodeActionPayload(tx, &p); err != nil {
			return "", err
		}
		return p.IdempotencyKey, nil
	case consensus.ActionResourceSponsor:
		var p consensus.ResourceSponsorshipPayload
		if err := decodeActionPayload(tx, &p); err != nil {
			return "", err
		}
		return p.IdempotencyKey, nil
	}
	return "", errors.New("unsupported Resource sponsor action")
}

func (g *Gateway) handleResourcePools(w http.ResponseWriter, r *http.Request) {
	var values []consensus.BFTResourcePool
	if err := g.queryABCIJSON(r.Context(), "/resource/pools", &values); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	owner, kind, status := strings.TrimSpace(r.URL.Query().Get("owner")), strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type"))), strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	filtered := make([]consensus.BFTResourcePool, 0, len(values))
	for _, value := range values {
		if owner != "" && value.Owner != owner || kind != "" && value.PoolType != kind || status != "" && value.Status != status {
			continue
		}
		filtered = append(filtered, value)
	}
	writeJSON(w, http.StatusOK, map[string]any{"pools": filtered})
}

func (g *Gateway) handleResourcePool(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var value consensus.BFTResourcePool
	if err := g.queryABCIJSON(r.Context(), "/resource/pools/"+id, &value); err != nil || value.ID != id {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Resource pool not found"})
		return
	}
	writeJSON(w, http.StatusOK, value)
}
func (g *Gateway) handleResourceSponsorship(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var value consensus.BFTResourceSponsorship
	if err := g.queryABCIJSON(r.Context(), "/resource/sponsorships/"+id, &value); err != nil || value.ID != id {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Resource sponsorship not found"})
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (g *Gateway) handleResourceSponsorships(w http.ResponseWriter, r *http.Request) {
	var values []consensus.BFTResourceSponsorship
	if err := g.queryABCIJSON(r.Context(), "/resource/sponsorships", &values); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	poolID, beneficiary := strings.TrimSpace(r.URL.Query().Get("poolId")), strings.TrimSpace(r.URL.Query().Get("beneficiary"))
	filtered := make([]consensus.BFTResourceSponsorship, 0, len(values))
	for _, value := range values {
		if poolID != "" && value.PoolID != poolID || beneficiary != "" && value.Beneficiary != beneficiary {
			continue
		}
		filtered = append(filtered, value)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sponsorships": filtered})
}

func (g *Gateway) handleResourceSponsorAudit(w http.ResponseWriter, r *http.Request) {
	var values []consensus.BFTResourceSponsorAudit
	if err := g.queryABCIJSON(r.Context(), "/resource/sponsor-audit", &values); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	sort.Slice(values, func(i, j int) bool { return values[i].Sequence < values[j].Sequence })
	writeJSON(w, http.StatusOK, map[string]any{"events": values})
}
