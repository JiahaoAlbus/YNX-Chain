package chain

import (
	"strings"
	"time"
)

func (d *Devnet) configureReplicationRuntimeLocked(source string) {
	source = strings.TrimRight(strings.TrimSpace(source), "/")
	latest := d.blocks[len(d.blocks)-1]
	if source == "" {
		d.replicationRuntime = ReplicationRuntimeStatus{
			Status:         "not_configured",
			Fresh:          true,
			LocalHeight:    latest.Height,
			LocalBlockHash: latest.Hash,
		}
		return
	}
	if d.replicationRuntime.Configured && d.replicationRuntime.Source == source {
		d.replicationRuntime.LocalHeight = latest.Height
		d.replicationRuntime.LocalBlockHash = latest.Hash
		return
	}
	d.replicationRuntime = ReplicationRuntimeStatus{
		Configured:     true,
		Source:         source,
		Status:         "starting",
		CatchingUp:     true,
		LocalHeight:    latest.Height,
		LocalBlockHash: latest.Hash,
	}
}

func (d *Devnet) BeginReplicationAttempt() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.replicationRuntime.Configured {
		return
	}
	now := time.Now().UTC()
	latest := d.blocks[len(d.blocks)-1]
	d.replicationRuntime.Status = "syncing"
	d.replicationRuntime.CatchingUp = true
	d.replicationRuntime.Fresh = false
	d.replicationRuntime.LocalHeight = latest.Height
	d.replicationRuntime.LocalBlockHash = latest.Hash
	d.replicationRuntime.Attempts++
	d.replicationRuntime.LastAttemptAt = &now
}

func (d *Devnet) RecordReplicationSuccess(result ReplicationApplyResult) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.replicationRuntime.Configured {
		return
	}
	now := time.Now().UTC()
	latest := d.blocks[len(d.blocks)-1]
	d.replicationRuntime.Status = "synced"
	d.replicationRuntime.CatchingUp = false
	d.replicationRuntime.Fresh = true
	d.replicationRuntime.LocalHeight = latest.Height
	d.replicationRuntime.LocalBlockHash = latest.Hash
	d.replicationRuntime.SourceHeight = result.Height
	d.replicationRuntime.SourceBlockHash = result.BlockHash
	d.replicationRuntime.LagBlocks = nonNegativeHeightLag(result.Height, latest.Height)
	d.replicationRuntime.Successes++
	d.replicationRuntime.ConsecutiveFailures = 0
	d.replicationRuntime.LastSuccessAt = &now
	d.replicationRuntime.LastErrorStage = ""
	d.replicationRuntime.LastError = ""
	if !result.SnapshotAt.IsZero() {
		snapshotAt := result.SnapshotAt.UTC()
		d.replicationRuntime.LastSnapshotAt = &snapshotAt
	}
	if d.replicationRuntime.LagBlocks > 0 || result.BlockHash != latest.Hash {
		d.replicationRuntime.Status = "catching_up"
		d.replicationRuntime.CatchingUp = true
		d.replicationRuntime.Fresh = false
	}
}

func (d *Devnet) RecordReplicationFailure(stage string, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.replicationRuntime.Configured {
		return
	}
	latest := d.blocks[len(d.blocks)-1]
	d.replicationRuntime.Status = "degraded"
	d.replicationRuntime.CatchingUp = true
	d.replicationRuntime.Fresh = false
	d.replicationRuntime.LocalHeight = latest.Height
	d.replicationRuntime.LocalBlockHash = latest.Hash
	d.replicationRuntime.ConsecutiveFailures++
	d.replicationRuntime.LastErrorStage = boundedReplicationText(stage, 32)
	if err != nil {
		d.replicationRuntime.LastError = boundedReplicationText(err.Error(), 512)
	} else {
		d.replicationRuntime.LastError = "replication attempt failed"
	}
}

func (d *Devnet) StopReplicationRuntime() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.replicationRuntime.Configured {
		return
	}
	latest := d.blocks[len(d.blocks)-1]
	d.replicationRuntime.Status = "stopped"
	d.replicationRuntime.CatchingUp = true
	d.replicationRuntime.Fresh = false
	d.replicationRuntime.LocalHeight = latest.Height
	d.replicationRuntime.LocalBlockHash = latest.Hash
}

func (d *Devnet) replicationRuntimeStatusLocked(now time.Time, interval, staleAfter time.Duration) ReplicationRuntimeStatus {
	status := d.replicationRuntime
	latest := d.blocks[len(d.blocks)-1]
	status.LocalHeight = latest.Height
	status.LocalBlockHash = latest.Hash
	if !status.Configured {
		status.Status = "not_configured"
		status.CatchingUp = false
		status.Fresh = true
		return status
	}
	if staleAfter <= 0 {
		staleAfter = interval * 3
	}
	if staleAfter < 15*time.Second {
		staleAfter = 15 * time.Second
	}
	status.Fresh = status.Status == "synced" && status.LastSuccessAt != nil && now.Sub(*status.LastSuccessAt) <= staleAfter
	if status.Status == "synced" && !status.Fresh {
		status.Status = "stale"
		status.CatchingUp = true
	}
	return status
}

func nonNegativeHeightLag(source, local uint64) int64 {
	if source <= local {
		return 0
	}
	delta := source - local
	if delta > uint64(^uint64(0)>>1) {
		return int64(^uint64(0) >> 1)
	}
	return int64(delta)
}

func boundedReplicationText(value string, limit int) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len(value) > limit {
		return value[:limit]
	}
	return value
}
