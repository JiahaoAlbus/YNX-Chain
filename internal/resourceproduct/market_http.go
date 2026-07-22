package resourceproduct

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/resourcemarket"
)

type marketAction struct {
	Type             string                  `json:"type"`
	Provider         resourcemarket.Provider `json:"provider,omitempty"`
	Offer            resourcemarket.Offer    `json:"offer,omitempty"`
	Receipt          resourcemarket.Receipt  `json:"receipt,omitempty"`
	Source           resourcemarket.Source   `json:"source,omitempty"`
	ProviderID       string                  `json:"providerId,omitempty"`
	OfferID          string                  `json:"offerId,omitempty"`
	QuoteID          string                  `json:"quoteId,omitempty"`
	OrderID          string                  `json:"orderId,omitempty"`
	DisputeID        string                  `json:"disputeId,omitempty"`
	AuctionID        string                  `json:"auctionId,omitempty"`
	ErasureRequestID string                  `json:"erasureRequestId,omitempty"`
	Evidence         string                  `json:"evidence,omitempty"`
	Reason           string                  `json:"reason,omitempty"`
	Decision         string                  `json:"decision,omitempty"`
	IntentDigest     string                  `json:"intentDigest,omitempty"`
	KeyID            string                  `json:"keyId,omitempty"`
	PublicKey        string                  `json:"publicKey,omitempty"`
	MigrationTarget  string                  `json:"migrationTarget,omitempty"`
	Enabled          bool                    `json:"enabled,omitempty"`
	Region           string                  `json:"region,omitempty"`
	Resource         string                  `json:"resource,omitempty"`
	Mode             string                  `json:"mode,omitempty"`
	Currency         string                  `json:"currency,omitempty"`
	Units            int64                   `json:"units,omitempty"`
	ProtocolFee      int64                   `json:"protocolFee,omitempty"`
	Quantity         int64                   `json:"quantity,omitempty"`
	Capacity         int64                   `json:"capacity,omitempty"`
	MaxUnits         int64                   `json:"maxUnits,omitempty"`
	MaxUnitPrice     int64                   `json:"maxUnitPrice,omitempty"`
	UnitPrice        int64                   `json:"unitPrice,omitempty"`
	ProtocolFeeBPS   int64                   `json:"protocolFeeBps,omitempty"`
	Penalty          int64                   `json:"penalty,omitempty"`
	Refund           int64                   `json:"refund,omitempty"`
	Start            time.Time               `json:"start,omitempty"`
	End              time.Time               `json:"end,omitempty"`
	ExpiresAt        time.Time               `json:"expiresAt,omitempty"`
	ClosesAt         time.Time               `json:"closesAt,omitempty"`
}

func (s *Service) registerMarketRoutes(mux *http.ServeMux) {
	if s.market == nil {
		return
	}
	mux.HandleFunc("GET /api/market/state", s.handleMarketState)
	mux.HandleFunc("GET /api/market/export", s.handleMarketExport)
	mux.HandleFunc("GET /api/market/matches", s.handleMarketMatches)
	mux.HandleFunc("POST /api/market/actions", s.handleMarketAction)
}

func (s *Service) handleMarketExport(w http.ResponseWriter, r *http.Request) {
	a, err := s.marketActor(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="ynx-resource-market-%s-v%d.json"`, resourcemarket.Digest(a.ID)[:12], resourcemarket.SchemaVersion))
	w.Header().Set("X-YNX-Export-Scope", "authenticated-actor")
	w.Header().Set("X-YNX-Retention-Notice", "settlement-dispute-and-audit-records-may-be-legally-retained")
	s.handleMarketState(w, r)
}

func (s *Service) marketActor(r *http.Request) (Actor, error) {
	a := s.actorFrom(r)
	if a.ID == "" || a.Role == "" {
		return Actor{}, apiError{401, "active canonical product session required"}
	}
	return a, nil
}

func (s *Service) handleMarketMatches(w http.ResponseWriter, r *http.Request) {
	if _, err := s.marketActor(r); err != nil {
		writeErr(w, err)
		return
	}
	resource := strings.TrimSpace(r.URL.Query().Get("resource"))
	units, err := parsePositiveInt(r.URL.Query().Get("units"))
	if err != nil || resourcemarket.ResourceUnits[resource] == "" {
		writeJSON(w, 422, map[string]string{"error": "supported resource and positive units are required"})
		return
	}
	writeJSON(w, 200, map[string]any{"offers": s.market.Match(resource, strings.TrimSpace(r.URL.Query().Get("region")), units), "source": "YNX Resource Market provider registry", "asOf": time.Now().UTC(), "version": resourcemarket.SchemaVersion})
}

func (s *Service) handleMarketState(w http.ResponseWriter, r *http.Request) {
	a, err := s.marketActor(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	ps, offers, quotes, orders, meters, receipts, disputes := s.market.Snapshot()
	auctions, auctionBids := s.market.AuctionSnapshot()
	erasureRequests := s.market.ErasureSnapshot()
	providerWallet := map[string]string{}
	for _, p := range ps {
		providerWallet[p.ID] = p.Wallet
	}
	if a.Role != "auditor" && a.Role != "resource_operator" {
		fq := quotes[:0]
		for _, v := range quotes {
			if v.Buyer == a.ID || providerWallet[v.ProviderID] == a.ID {
				fq = append(fq, v)
			}
		}
		quotes = fq
		fo := orders[:0]
		allowed := map[string]bool{}
		for _, v := range orders {
			if v.Buyer == a.ID || providerWallet[v.ProviderID] == a.ID {
				fo = append(fo, v)
				allowed[v.ID] = true
			}
		}
		orders = fo
		fm := meters[:0]
		for _, v := range meters {
			if allowed[v.OrderID] {
				fm = append(fm, v)
			}
		}
		meters = fm
		fr := receipts[:0]
		for _, v := range receipts {
			if allowed[v.OrderID] {
				fr = append(fr, v)
			}
		}
		receipts = fr
		fd := disputes[:0]
		for _, v := range disputes {
			if allowed[v.OrderID] {
				fd = append(fd, v)
			}
		}
		disputes = fd
		visibleBids := auctionBids[:0]
		for _, bid := range auctionBids {
			auction := findAuction(auctions, bid.AuctionID)
			if providerWallet[bid.ProviderID] == a.ID || (auction.Buyer == a.ID && auction.Status != "open") {
				visibleBids = append(visibleBids, bid)
			}
		}
		auctionBids = visibleBids
		visibleErasure := erasureRequests[:0]
		for _, request := range erasureRequests {
			if request.Subject == a.ID || a.Role == "retention_operator" {
				visibleErasure = append(visibleErasure, request)
			}
		}
		erasureRequests = visibleErasure
	}
	writeJSON(w, 200, map[string]any{"schemaVersion": resourcemarket.SchemaVersion, "providers": ps, "offers": offers, "quotes": quotes, "orders": orders, "meters": meters, "receipts": receipts, "disputes": disputes, "auctions": auctions, "auctionBids": auctionBids, "erasureRequests": erasureRequests, "authority": "YNX Resource Market local Testnet state; asset settlement requires authoritative receipt evidence"})
}

func findAuction(auctions []resourcemarket.Auction, id string) resourcemarket.Auction {
	for _, auction := range auctions {
		if auction.ID == id {
			return auction
		}
	}
	return resourcemarket.Auction{}
}

func (s *Service) handleMarketAction(w http.ResponseWriter, r *http.Request) {
	a, err := s.marketActor(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in marketAction
	if err := decodeActionBody(r, &in); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	var out any
	switch in.Type {
	case "register_provider":
		out, err = s.market.RegisterProvider(a.ID, in.Provider)
	case "verify_provider":
		if a.Role != "resource_verifier" {
			err = apiError{403, "resource_verifier role required"}
		} else {
			out, err = s.market.VerifyProvider(a.ID, in.ProviderID, in.Provider.Evidence)
		}
	case "publish_offer":
		out, err = s.market.PublishOffer(a.ID, in.Offer)
	case "create_auction":
		out, err = s.market.CreateAuction(a.ID, in.Mode, in.Resource, in.Region, in.Currency, in.Units, in.MaxUnitPrice, in.ProtocolFeeBPS, in.ClosesAt, in.Source)
	case "submit_auction_bid":
		out, err = s.market.SubmitAuctionBid(a.ID, in.AuctionID, in.OfferID, in.Units, in.UnitPrice, in.Source)
	case "clear_auction":
		if a.Role != "auction_operator" {
			err = apiError{403, "auction_operator role required"}
		} else {
			out, err = s.market.ClearAuction(a.ID, in.AuctionID)
		}
	case "request_erasure":
		out, err = s.market.RequestErasure(a.ID, in.Reason, in.Source)
	case "fulfill_erasure":
		if a.Role != "retention_operator" {
			err = apiError{403, "retention_operator role required"}
		} else {
			out, err = s.market.FulfillErasure(a.ID, in.ErasureRequestID)
		}
	case "apply_retention":
		if a.Role != "retention_operator" {
			err = apiError{403, "retention_operator role required"}
		} else {
			out, err = s.market.ApplyRetention(a.ID)
		}
	case "set_maintenance":
		out, err = s.market.SetMaintenance(a.ID, in.ProviderID, in.Enabled, in.Evidence)
	case "update_capacity":
		out, err = s.market.UpdateCapacity(a.ID, in.OfferID, in.Capacity, in.MaxUnits, in.Source)
	case "exit_provider":
		out, err = s.market.ExitProvider(a.ID, in.ProviderID, in.Evidence, in.MigrationTarget)
	case "register_worker_key":
		out, err = s.market.RegisterWorkerKey(a.ID, in.ProviderID, in.KeyID, in.PublicKey, in.ExpiresAt, in.Source)
	case "revoke_worker_key":
		out, err = s.market.RevokeWorkerKey(a.ID, in.KeyID)
	case "create_quote":
		out, err = s.market.CreateQuote(a.ID, in.OfferID, in.Units, in.ProtocolFee)
	case "accept_intent":
		out, err = s.market.AcceptIntent(a.ID, in.QuoteID, in.IntentDigest)
	case "reserve":
		out, err = s.market.Reserve(a.ID, in.OrderID, in.Evidence)
	case "start_service":
		out, err = s.market.StartService(a.ID, in.OrderID, in.Evidence)
	case "prepare_meter":
		out, err = s.market.PrepareMeter(a.ID, in.OrderID, in.Start, in.End, in.Quantity, in.Source)
	case "record_usage":
		out, err = s.market.RecordUsage(a.ID, in.OrderID, in.Start, in.End, in.Quantity, in.Evidence, in.Source)
	case "complete_service":
		out, err = s.market.CompleteService(a.ID, in.OrderID, in.Evidence)
	case "settlement_pending":
		out, err = s.market.MarkSettlementPending(a.ID, in.OrderID)
	case "confirm_settlement":
		if a.Role != "settlement_authority" {
			err = apiError{403, "settlement_authority role required"}
		} else {
			out, err = s.market.ConfirmSettlement(a.ID, in.OrderID, in.Receipt)
		}
	case "report_failure":
		out, err = s.market.ReportFailure(a.ID, in.OrderID, in.Evidence)
	case "retry_failure":
		out, err = s.market.RetryFailure(a.ID, in.OrderID)
	case "open_dispute":
		out, err = s.market.OpenDispute(a.ID, in.OrderID, in.Reason, in.Evidence)
	case "decide_dispute":
		if a.Role != "dispute_reviewer" {
			err = apiError{403, "dispute_reviewer role required"}
		} else {
			out, err = s.market.DecideDispute(a.ID, in.DisputeID, in.Decision, in.Evidence, in.Penalty, in.Refund)
		}
	case "appeal_dispute":
		out, err = s.market.AppealDispute(a.ID, in.DisputeID, in.Reason, in.Evidence)
	case "resolve_appeal":
		if a.Role != "dispute_reviewer" {
			err = apiError{403, "dispute_reviewer role required"}
		} else {
			out, err = s.market.ResolveAppeal(a.ID, in.DisputeID, in.Decision, in.Evidence)
		}
	default:
		err = apiError{400, "unknown market action type"}
	}
	if err != nil {
		if _, ok := err.(apiError); ok {
			writeErr(w, err)
		} else {
			writeJSON(w, 422, map[string]string{"error": err.Error()})
		}
		return
	}
	writeJSON(w, 200, map[string]any{"result": out})
}

func parsePositiveInt(v string) (int64, error) {
	var n int64
	if _, err := fmt.Sscan(v, &n); err != nil || n <= 0 {
		return 0, errors.New("positive integer required")
	}
	return n, nil
}
