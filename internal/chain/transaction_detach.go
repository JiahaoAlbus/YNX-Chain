package chain

import (
	"encoding"
	"encoding/json"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"
)

// Match every encoded field's name, type and JSON tag. A later model change
// falls back to the original encoder even if its field count remains the same.
type transactionDetachField struct{ name, typ, tag string }

func transactionDetachHasCodec(typ reflect.Type) bool {
	for _, candidate := range []reflect.Type{typ, reflect.PointerTo(typ)} {
		if candidate.Implements(reflect.TypeOf((*json.Marshaler)(nil)).Elem()) || candidate.Implements(reflect.TypeOf((*json.Unmarshaler)(nil)).Elem()) || candidate.Implements(reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem()) || candidate.Implements(reflect.TypeOf((*encoding.TextUnmarshaler)(nil)).Elem()) {
			return true
		}
	}
	return false
}
func transactionDetachMatches(typ reflect.Type, want []transactionDetachField) bool {
	if typ.Kind() != reflect.Struct || typ.NumField() != len(want) || transactionDetachHasCodec(typ) {
		return false
	}
	for i, w := range want {
		f := typ.Field(i)
		if f.Name != w.name || f.Type.String() != w.typ || f.Tag.Get("json") != w.tag || f.Anonymous || f.PkgPath != "" {
			return false
		}
	}
	return true
}
func transactionDetachSchema() bool {
	return transactionDetachMatches(reflect.TypeOf(Transaction{}), []transactionDetachField{
		{"Hash", "string", "hash"}, {"Type", "string", "type"}, {"From", "string", "from,omitempty"}, {"To", "string", "to,omitempty"},
		{"Amount", "int64", "amount,omitempty"}, {"Fee", "int64", "fee"}, {"Nonce", "uint64", "nonce"}, {"BlockHash", "string", "blockHash,omitempty"},
		{"BlockNum", "uint64", "blockNumber,omitempty"}, {"Timestamp", "time.Time", "timestamp"}, {"LotFlows", "[]chain.LotFlow", "lotFlows,omitempty"},
		{"Logs", "[]chain.EVMLog", "logs,omitempty"}, {"Memo", "string", "memo,omitempty"}, {"Sponsor", "string", "sponsor,omitempty"},
		{"SponsorPoolID", "string", "sponsorPoolId,omitempty"}, {"ResourceSource", "string", "resourceSource,omitempty"}, {"ResourceType", "string", "resourceType,omitempty"},
		{"ResourceConsumed", "int64", "resourceConsumed,omitempty"}, {"ActionReference", "string", "actionReference,omitempty"},
	}) && transactionDetachMatches(reflect.TypeOf(LotFlow{}), []transactionDetachField{{"LotID", "string", "lotId"}, {"Amount", "int64", "amount"}, {"From", "string", "from"}, {"To", "string", "to"}}) &&
		transactionDetachMatches(reflect.TypeOf(EVMLog{}), []transactionDetachField{{"Address", "string", "address"}, {"Topics", "[]string", "topics"}, {"Data", "string", "data"},
			{"BlockHash", "string", "blockHash"}, {"BlockNumber", "uint64", "blockNumber"}, {"TransactionHash", "string", "transactionHash"},
			{"TransactionIndex", "uint64", "transactionIndex"}, {"LogIndex", "uint64", "logIndex"}, {"Removed", "bool", "removed"}})
}

// The original per-block JSON round trip remains the fallback for any value
// whose decoder normalization is not proven identical. No cross-call cache.
// Strings are cloned even though strings are ordinarily immutable, so the
// owner stays detached when caller-created unsafe strings share byte storage.
func detachOrdinaryTransactions(src []Transaction) ([]Transaction, bool) {
	if src == nil {
		return nil, true
	}
	if !transactionDetachSchema() {
		return nil, false
	}
	valid := func(values ...string) bool {
		for _, v := range values {
			if !utf8.ValidString(v) {
				return false
			}
		}
		return true
	}
	for _, t := range src {
		if !valid(t.Hash, t.Type, t.From, t.To, t.BlockHash, t.Memo, t.Sponsor, t.SponsorPoolID, t.ResourceSource, t.ResourceType, t.ActionReference) {
			return nil, false
		}
		raw, err := t.Timestamp.MarshalJSON()
		if err != nil {
			return nil, false
		}
		var normalized time.Time
		if err = normalized.UnmarshalJSON(raw); err != nil || normalized != t.Timestamp {
			return nil, false
		}
		for _, flow := range t.LotFlows {
			if !valid(flow.LotID, flow.From, flow.To) {
				return nil, false
			}
		}
		for _, log := range t.Logs {
			if !valid(log.Address, log.Data, log.BlockHash, log.TransactionHash) {
				return nil, false
			}
			for _, topic := range log.Topics {
				if !utf8.ValidString(topic) {
					return nil, false
				}
			}
		}
	}
	result := make([]Transaction, len(src))
	for i, t := range src {
		result[i] = t
		dst := &result[i]
		dst.Hash = strings.Clone(t.Hash)
		dst.Type = strings.Clone(t.Type)
		dst.From = strings.Clone(t.From)
		dst.To = strings.Clone(t.To)
		dst.BlockHash = strings.Clone(t.BlockHash)
		dst.Memo = strings.Clone(t.Memo)
		dst.Sponsor = strings.Clone(t.Sponsor)
		dst.SponsorPoolID = strings.Clone(t.SponsorPoolID)
		dst.ResourceSource = strings.Clone(t.ResourceSource)
		dst.ResourceType = strings.Clone(t.ResourceType)
		dst.ActionReference = strings.Clone(t.ActionReference)
		dst.LotFlows = nil
		if len(t.LotFlows) > 0 {
			dst.LotFlows = make([]LotFlow, len(t.LotFlows))
			for j, flow := range t.LotFlows {
				dst.LotFlows[j] = flow
				dst.LotFlows[j].LotID = strings.Clone(flow.LotID)
				dst.LotFlows[j].From = strings.Clone(flow.From)
				dst.LotFlows[j].To = strings.Clone(flow.To)
			}
		}
		dst.Logs = nil
		if len(t.Logs) > 0 {
			dst.Logs = make([]EVMLog, len(t.Logs))
			for j, log := range t.Logs {
				dst.Logs[j] = log
				entry := &dst.Logs[j]
				entry.Address = strings.Clone(log.Address)
				entry.Data = strings.Clone(log.Data)
				entry.BlockHash = strings.Clone(log.BlockHash)
				entry.TransactionHash = strings.Clone(log.TransactionHash)
				if log.Topics != nil {
					entry.Topics = make([]string, len(log.Topics))
					for k, topic := range log.Topics {
						entry.Topics[k] = strings.Clone(topic)
					}
				}
			}
		}
	}
	return result, true
}
