package developerauthority

// Three fixed SQL statements on the SAME Catalog-owned connection/tx only.
// This is not a generic query/driver/endpoint callback surface. Driver panics
// are contained BEFORE leaving Conn.Raw so database/sql always releases its
// connection lock; the original Catalog can then roll back its same Tx.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strconv"
	"unicode/utf8"
)

type originalPublisherTransactionRow struct {
	values []driver.Value
	err    error
}

func (o *originalPublisherCatalogOperation) driverStep(run func() error) (err error) {
	defer func() {
		if p := recover(); p != nil {
			if o.panicCause == nil {
				o.panicCause = p
			}
			err = ErrUnknown
		}
	}()
	if err = run(); err != nil {
		if o.driverCause == nil {
			o.driverCause = err
		}
		return ErrUnknown
	}
	return nil
}
func (o *originalPublisherCatalogOperation) fixedTransactionRow(ctx context.Context, query string, args ...any) *originalPublisherTransactionRow {
	out := &originalPublisherTransactionRow{}
	columns, arity := 0, 0
	switch query {
	case originalPublisherCatalogRowSQL:
		columns, arity = 8, 2
	case originalPublisherCatalogActivateSQL:
		columns, arity = 1, 20
	case originalPublisherCatalogRevokeSQL:
		columns, arity = 1, 8
	default:
		out.err = ErrDenied
		return out
	}
	if o.connection == nil || o.tx == nil || ctx == nil || ctx.Err() != nil || len(args) != arity {
		out.err = ErrDenied
		return out
	}
	params := make([]driver.NamedValue, len(args))
	for i, v := range args {
		converted, e := driver.DefaultParameterConverter.ConvertValue(v)
		if e != nil {
			out.err = ErrDenied
			return out
		}
		params[i] = driver.NamedValue{Ordinal: i + 1, Value: converted}
	}
	out.err = o.connection.Raw(func(raw any) (err error) {
		q, ok := raw.(driver.QueryerContext)
		if !ok {
			return ErrDenied
		} // no fallback/replay
		var rows driver.Rows
		queryError := o.driverStep(func() error { var e error; rows, e = q.QueryContext(ctx, query, params); return e })
		// A driver may return a real partial rows owner alongside an error. Retain
		// it BEFORE inspecting that error; close once and retain uncertain cleanup.
		if rows != nil {
			index := len(o.partialRows)
			o.partialRows = append(o.partialRows, rows)
			defer func() {
				closeError := o.driverStep(rows.Close)
				if closeError == nil {
					o.partialRows[index] = nil
				} else if err == nil {
					err = closeError
				}
			}()
		}
		if queryError != nil {
			return queryError
		}
		if rows == nil {
			return ErrUnknown
		}
		var names []string
		if e := o.driverStep(func() error { names = rows.Columns(); return nil }); e != nil {
			return e
		}
		if len(names) != columns {
			return ErrUnknown
		}
		values := make([]driver.Value, columns)
		var next error
		if e := o.driverStep(func() error {
			next = rows.Next(values)
			if next == io.EOF {
				return nil
			}
			return next
		}); e != nil {
			return e
		}
		if next == io.EOF {
			return sql.ErrNoRows
		}
		// Own every returned byte before the driver can reuse/close its buffer.
		for i, v := range values {
			if b, ok := v.([]byte); ok {
				if len(b) > 8192 {
					return ErrUnknown
				}
				values[i] = append([]byte(nil), b...)
			} else if s, ok := v.(string); ok && len(s) > 8192 {
				return ErrUnknown
			}
		}
		extra := make([]driver.Value, columns)
		if e := o.driverStep(func() error {
			next = rows.Next(extra)
			if next == io.EOF {
				return nil
			}
			return next
		}); e != nil {
			return e
		}
		if next != io.EOF {
			return ErrUnknown
		}
		out.values = values
		return nil
	})
	// Never return ErrBadConn from the Raw callback: Conn.Raw would try to close
	// an active Tx connection, and automatic pool retry is forbidden here.
	return out
}
func (r *originalPublisherTransactionRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return ErrUnknown
	}
	for i, p := range dest {
		v := r.values[i]
		switch d := p.(type) {
		case *string:
			var s string
			switch x := v.(type) {
			case string:
				s = x
			case []byte:
				if !utf8.Valid(x) {
					return ErrUnknown
				}
				s = string(x)
			default:
				return ErrUnknown
			}
			if !utf8.ValidString(s) {
				return ErrUnknown
			}
			*d = s
		case *[]byte:
			switch x := v.(type) {
			case []byte:
				*d = append([]byte(nil), x...)
			case string:
				*d = []byte(x)
			default:
				return ErrUnknown
			}
		case *bool:
			b, ok := v.(bool)
			if !ok {
				return ErrUnknown
			}
			*d = b
		case *uint64:
			n, e := originalPublisherDriverInt(v)
			if e != nil || n < 0 {
				return ErrUnknown
			}
			*d = uint64(n)
		case *int64:
			n, e := originalPublisherDriverInt(v)
			if e != nil {
				return e
			}
			*d = n
		default:
			return ErrUnknown
		}
	}
	return nil
}
func originalPublisherDriverInt(v driver.Value) (int64, error) {
	if n, ok := v.(int64); ok {
		return n, nil
	}
	var s string
	switch x := v.(type) {
	case string:
		s = x
	case []byte:
		s = string(x)
	default:
		return 0, ErrUnknown
	}
	n, e := strconv.ParseInt(s, 10, 64)
	if e != nil || strconv.FormatInt(n, 10) != s {
		return 0, ErrUnknown
	}
	return n, nil
}

// Runs after the original Tx finalizer; never SQL or an automatic retry.
func (o *originalPublisherCatalogOperation) finishConnection() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.connection == nil {
		return ErrUnknown
	}
	discard := o.panicCause != nil || errors.Is(o.driverCause, driver.ErrBadConn) || o.rollbackCause != nil
	for _, r := range o.partialRows {
		if r != nil {
			discard = true
		}
	}
	if discard {
		e := o.connection.Raw(func(any) error { return driver.ErrBadConn })
		if e != nil && !errors.Is(e, driver.ErrBadConn) && !errors.Is(e, sql.ErrConnDone) {
			o.connectionCloseCause = e
			return ErrUnknown
		}
	}
	e := o.connection.Close()
	if errors.Is(e, sql.ErrConnDone) && discard {
		return nil
	}
	if e != nil {
		o.connectionCloseCause = e
		return ErrUnknown
	}
	return nil
}
