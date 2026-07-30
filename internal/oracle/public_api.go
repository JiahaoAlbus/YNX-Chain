package oracle

import (
	"errors"
	"net/http"
	"strconv"
)

func (server *Server) markets(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"schema": SchemaVersion,
		"source": "YNX Oracle versioned market registry and persisted runtime state",
		"asOf":   server.service.now().UTC(),
		"items":  server.service.Markets(),
	})
}

func (server *Server) status(response http.ResponseWriter, _ *http.Request) {
	health := server.service.Health()
	health.Commit = BuildCommit
	writeJSON(response, http.StatusOK, map[string]any{
		"schema":    SchemaVersion,
		"source":    "YNX Oracle runtime status",
		"asOf":      server.service.now().UTC(),
		"health":    health,
		"providers": server.service.Providers(),
		"markets":   server.service.Markets(),
	})
}

func (server *Server) history(response http.ResponseWriter, request *http.Request) {
	limit, err := publicQueryLimit(request, 100)
	if err != nil {
		writeFailure(response, http.StatusBadRequest, "invalid limit")
		return
	}
	market, kind := request.URL.Query().Get("market"), DataType(request.URL.Query().Get("type"))
	items, err := server.service.History(market, kind, limit)
	if err != nil {
		writeFailure(response, http.StatusBadRequest, publicError(err))
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"schema": SchemaVersion,
		"source": "YNX Oracle immutable aggregate history",
		"asOf":   server.service.now().UTC(),
		"market": market,
		"type":   kind,
		"items":  items,
	})
}

func (server *Server) corrections(response http.ResponseWriter, request *http.Request) {
	limit, err := publicQueryLimit(request, 100)
	if err != nil {
		writeFailure(response, http.StatusBadRequest, "invalid limit")
		return
	}
	market, kind := request.URL.Query().Get("market"), DataType(request.URL.Query().Get("type"))
	items, err := server.service.Corrections(market, kind, limit)
	if err != nil {
		writeFailure(response, http.StatusBadRequest, publicError(err))
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"schema": SchemaVersion,
		"source": "YNX Oracle audited correction events; original observations remain immutable",
		"asOf":   server.service.now().UTC(),
		"market": market,
		"type":   kind,
		"items":  items,
	})
}

func (server *Server) publicMetrics(response http.ResponseWriter, _ *http.Request) {
	health := server.service.Health()
	health.Commit = BuildCommit
	writeJSON(response, http.StatusOK, map[string]any{
		"schema":  SchemaVersion,
		"source":  "YNX Oracle sanitized public runtime metrics",
		"asOf":    server.service.now().UTC(),
		"health":  health,
		"metrics": server.metrics.Snapshot(),
	})
}

func publicQueryLimit(request *http.Request, defaultLimit int) (int, error) {
	raw := request.URL.Query().Get("limit")
	if raw == "" {
		return defaultLimit, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > 1000 {
		return 0, errors.New("invalid limit")
	}
	return value, nil
}
