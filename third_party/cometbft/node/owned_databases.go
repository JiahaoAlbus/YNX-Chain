package node

import (
	"errors"
	"fmt"
	"sync"

	dbm "github.com/cometbft/cometbft-db"
	"github.com/cometbft/cometbft/config"
)

// A node owns every database obtained through its provider. In particular the
// tx index and block-event prefix index share one tx_index handle, which neither
// index interface closes. Stores may close their handle first; the underlying
// database is still closed exactly once by this common owner.
type nodeOwnedDatabase struct {
	dbm.DB
	id   string
	once sync.Once
	err  error
}

func (d *nodeOwnedDatabase) Close() error {
	d.once.Do(func() { d.err = d.DB.Close() })
	return d.err
}

type nodeOwnedDatabases struct {
	handles []*nodeOwnedDatabase
}

func (o *nodeOwnedDatabases) provider(provider config.DBProvider) config.DBProvider {
	return func(ctx *config.DBContext) (dbm.DB, error) {
		db, err := provider(ctx)
		if err != nil {
			return nil, fmt.Errorf("open node database %s: %w", ctx.ID, err)
		}
		owned := &nodeOwnedDatabase{DB: db, id: ctx.ID}
		o.handles = append(o.handles, owned)
		return owned, nil
	}
}

// Call only after all database consumers have stopped. Construction and close
// belong to the node lifecycle, never to peer input or transaction execution.
func (o *nodeOwnedDatabases) Close() error {
	var errs []error
	for i := len(o.handles) - 1; i >= 0; i-- {
		if err := o.handles[i].Close(); err != nil {
			errs = append(errs, fmt.Errorf("close node database %s: %w", o.handles[i].id, err))
		}
	}
	return errors.Join(errs...)
}
