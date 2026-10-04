package music

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type musicAIReceipt struct {
	Result string `json:"result"`
}

func validateAIReceipt(raw []byte) error {
	var v musicAIReceipt
	if err := strictEffectJSON(raw, &v); err != nil {
		return err
	}
	if len(v.Result) > 12000 {
		return ErrInvalid
	}
	return nil
}
func aiStreamPermission(st *persistentState, actor, id string) error {
	p, ok := st.AIProposals[id]
	if !ok {
		return ErrNotFound
	}
	if p.Owner != actor || !p.Permission {
		return ErrUnauthorized
	}
	for _, id := range p.ContextTrackIDs {
		track, err := visibleTrack(st, actor, id)
		if err != nil {
			return err
		}
		if track.Owner != actor && !contains(st.Listeners[actor].Favorites, id) {
			return ErrUnauthorized
		}
	}
	return nil
}

// Only complete token frames are released. The provider done frame is withheld
// until EOF and Music's durable receipt/business commit both succeed.
func readMusicAIStream(body io.Reader, token func(string) error) (string, error) {
	bounded := &io.LimitedReader{R: body, N: (128 << 10) + 1}
	scanner := bufio.NewScanner(bounded)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	event, data := "", ""
	hasData, done := false, false
	total := 0
	var result strings.Builder
	flush := func() error {
		if event == "" && !hasData {
			return nil
		}
		if done {
			return errors.New("AI stream contains event after completion")
		}
		if !hasData {
			return errors.New("AI stream event has no data")
		}
		switch event {
		case "", "token":
			var v struct {
				Text string `json:"text"`
			}
			if err := strictEffectJSON([]byte(data), &v); err != nil {
				return err
			}
			if result.Len()+len(v.Text) > 12000 {
				return ErrInvalid
			}
			result.WriteString(v.Text)
			if token != nil {
				if err := token(v.Text); err != nil {
					return err
				}
			}
		case "metadata":
			var v struct {
				RequestID string `json:"requestId"`
			}
			if err := strictEffectJSON([]byte(data), &v); err != nil {
				return err
			}
			if v.RequestID == "" || len(v.RequestID) > 256 {
				return ErrInvalid
			}
		case "done":
			var v struct{}
			if err := strictEffectJSON([]byte(data), &v); err != nil {
				return err
			}
			done = true
		default:
			return errors.New("AI stream event is not supported")
		}
		event, data = "", ""
		hasData = false
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		total += len(line) + 1
		if total > 128<<10 {
			return "", ErrInvalid
		}
		if line == "" {
			if err := flush(); err != nil {
				return "", err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, ok := strings.Cut(line, ":")
		if !ok {
			return "", ErrInvalid
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			if event != "" {
				return "", ErrInvalid
			}
			event = value
		case "data":
			if hasData {
				return "", ErrInvalid
			}
			data = value
			hasData = true
		default:
			return "", ErrInvalid
		}
	}
	if bounded.N <= 0 {
		return "", ErrInvalid
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	if err := flush(); err != nil {
		return "", err
	}
	if !done {
		return "", errors.New("AI stream ended without provider completion")
	}
	return result.String(), nil
}
func musicAIEndpoint(gateway string, p AIProposal) (string, error) {
	u, err := url.Parse(strings.TrimSpace(gateway))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return "", ErrInvalid
	}
	q := url.Values{}
	q.Set("session", p.ID)
	if p.OutputLanguage != "" {
		q.Set("outputLanguage", p.OutputLanguage)
	}
	if p.ExplanationRequired {
		q.Set("explanationRequired", "true")
	}
	prompt := p.Intent + ". Use only these authorized YNX Music track IDs: " + strings.Join(p.ContextTrackIDs, ",")
	if p.OutputLanguage != "" {
		prompt += ". Respond in language " + p.OutputLanguage
	}
	if p.ExplanationRequired {
		prompt += ". Explain your recommendation using only authorized records"
	}
	q.Set("q", prompt)
	return strings.TrimRight(u.String(), "/") + "/ai/stream?" + q.Encode(), nil
}
func (s *Server) aiBusinessStream(w http.ResponseWriter, r *http.Request, actor string) {
	service := s.service
	id := r.PathValue("id")
	p, err := service.AIProposal(actor, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	endpoint, err := musicAIEndpoint(service.cfg.AIGatewayURL, p)
	if err != nil || service.cfg.AIGatewayKey == "" {
		writeJSON(w, 503, map[string]string{"error": "YNX AI Gateway is not configured"})
		return
	}
	journalKey := effectKey(actor, "ai", id)
	wire := effectDigest([]byte("GET\n" + endpoint))
	endpointHash := effectDigest([]byte(strings.TrimRight(service.cfg.AIGatewayURL, "/") + "/ai/stream"))
	var existing MusicBusinessEffect
	err = service.mutate(actor, "ai_stream_dispatch_admitted", id, map[string]string{"wireDigest": wire}, func(st *persistentState) error {
		if err := aiStreamPermission(st, actor, id); err != nil {
			return err
		}
		if e, ok := st.BusinessEffects[journalKey]; ok {
			if err := service.business.checkOriginalEffectAssociation(e); err != nil {
				return err
			}
			if e.Actor != actor || e.WireDigest != wire || e.EndpointDigest != endpointHash {
				return ErrConflict
			}
			existing = e
			return errEffectExisting
		}
		proposal := st.AIProposals[id]
		if proposal.Status != "awaiting_gateway" || len(st.BusinessEffects) >= 2048 {
			return ErrConflict
		}
		if st.BusinessEffects == nil {
			st.BusinessEffects = map[string]MusicBusinessEffect{}
		}
		st.BusinessEffects[journalKey] = MusicBusinessEffect{Actor: actor, Kind: "ai", ObjectID: id, WireDigest: wire, EndpointDigest: endpointHash, Status: "dispatch_admitted", AdmittedAt: service.cfg.Now().UTC()}
		proposal.Status = "streaming"
		proposal.UpdatedAt = service.cfg.Now().UTC()
		st.AIProposals[id] = proposal
		return nil
	})
	guard := func() error {
		if err := service.currentBusinessAuthority(); err != nil {
			return err
		}
		service.mu.RLock()
		defer service.mu.RUnlock()
		return aiStreamPermission(&service.state, actor, id)
	}
	emit := func(text string) error {
		if err := guard(); err != nil {
			return err
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		raw, _ := json.Marshal(map[string]string{"text": text})
		if _, err := fmt.Fprintf(w, "event: token\ndata: %s\n\n", raw); err != nil {
			return err
		}
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		return nil
	}
	if errors.Is(err, errEffectExisting) {
		if existing.Status != "receipt" {
			writeErr(w, fmt.Errorf("%w: AI stream outcome requires reconciliation; not resent", ErrConflict))
			return
		}
		var receipt musicAIReceipt
		if err := strictEffectJSON(existing.Receipt, &receipt); err != nil {
			writeErr(w, err)
			return
		}
		if err := emit(receipt.Result); err != nil {
			return
		}
		if guard() == nil {
			fmt.Fprint(w, "event: done\ndata: {}\n\n")
		}
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := guard(); err != nil {
		writeErr(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(service.business.ctx, 15*time.Second)
	defer cancel()
	up, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		writeErr(w, err)
		return
	}
	up.Header.Set("X-YNX-AI-Key", service.cfg.AIGatewayKey)
	client := *service.cfg.HTTPClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(up)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "AI stream outcome is unknown; not resent"})
		return
	}
	defer resp.Body.Close()
	kind, _, typeErr := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if resp.StatusCode != 200 || typeErr != nil || kind != "text/event-stream" {
		writeJSON(w, 502, map[string]string{"error": "AI Gateway stream rejected; outcome is not complete"})
		return
	}
	result, err := readMusicAIStream(resp.Body, emit)
	if err != nil {
		return
	}
	receipt, _ := json.Marshal(musicAIReceipt{Result: result})
	err = service.mutate(actor, "ai_stream_completed", id, map[string]string{"resultDigest": effectDigest(receipt)}, func(st *persistentState) error {
		if err := aiStreamPermission(st, actor, id); err != nil {
			return err
		}
		e, ok := st.BusinessEffects[journalKey]
		proposal := st.AIProposals[id]
		if !ok || e.Status != "dispatch_admitted" || e.WireDigest != wire || proposal.Status != "streaming" {
			return ErrConflict
		}
		e.Status = "receipt"
		e.Receipt = append(json.RawMessage(nil), receipt...)
		st.BusinessEffects[journalKey] = e
		proposal.Status = "completed"
		proposal.Result = strings.TrimSpace(result)
		proposal.UpdatedAt = service.cfg.Now().UTC()
		st.AIProposals[id] = proposal
		return nil
	})
	if err == nil && guard() == nil {
		fmt.Fprint(w, "event: done\ndata: {}\n\n")
	}
}
