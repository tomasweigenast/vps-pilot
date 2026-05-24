package metrics

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

// HistoryPoint is a single stored metrics snapshot.
type HistoryPoint struct {
	RecordedAt   string  `json:"recordedAt"`
	CPUPercent   float64 `json:"cpuPercent"`
	MemUsed      int64   `json:"memUsed"`
	MemTotal     int64   `json:"memTotal"`
	DiskUsed     int64   `json:"diskUsed"`
	DiskTotal    int64   `json:"diskTotal"`
	NetBytesSent int64   `json:"netBytesSent"`
	NetBytesRecv int64   `json:"netBytesRecv"`
}

// InsertSnapshot stores a new metrics point in the database.
func InsertSnapshot(db *sql.DB, snap *Snapshot) error {
	var diskUsed, diskTotal int64
	for _, d := range snap.Disks {
		diskUsed += int64(d.Used)
		diskTotal += int64(d.Total)
	}
	var netSent, netRecv int64
	for _, n := range snap.Network {
		netSent += int64(n.BytesSent)
		netRecv += int64(n.BytesRecv)
	}
	_, err := db.Exec(
		`INSERT INTO metrics_snapshots
			(cpu_percent, mem_used, mem_total, disk_used, disk_total, net_bytes_sent, net_bytes_recv)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		snap.CPU.UsagePercent,
		snap.Memory.Used, snap.Memory.Total,
		diskUsed, diskTotal,
		netSent, netRecv,
	)
	return err
}

// QuerySnapshots returns snapshots recorded within [from, now].
func QuerySnapshots(db *sql.DB, from time.Time) ([]HistoryPoint, error) {
	rows, err := db.Query(
		`SELECT recorded_at, cpu_percent, mem_used, mem_total,
			disk_used, disk_total, net_bytes_sent, net_bytes_recv
		FROM metrics_snapshots
		WHERE recorded_at >= ?
		ORDER BY recorded_at ASC`,
		from.UTC().Format(time.RFC3339),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []HistoryPoint
	for rows.Next() {
		var p HistoryPoint
		if err := rows.Scan(
			&p.RecordedAt,
			&p.CPUPercent, &p.MemUsed, &p.MemTotal,
			&p.DiskUsed, &p.DiskTotal, &p.NetBytesSent, &p.NetBytesRecv,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PurgeOldSnapshots deletes snapshots older than maxAge.
func PurgeOldSnapshots(db *sql.DB, maxAge time.Duration) error {
	cutoff := time.Now().UTC().Add(-maxAge).Format(time.RFC3339)
	_, err := db.Exec(`DELETE FROM metrics_snapshots WHERE recorded_at < ?`, cutoff)
	return err
}

// StartMetricsRecorder collects and stores metrics every interval, purging
// data older than maxAge. It runs in a background goroutine until ctx is done.
func StartMetricsRecorder(ctx context.Context, db *sql.DB, interval, maxAge time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				snap, err := Collect(ctx)
				if err != nil {
					slog.Warn("metrics collect failed", "err", err)
					continue
				}
				if err := InsertSnapshot(db, snap); err != nil {
					slog.Warn("metrics insert failed", "err", err)
				}
				if err := PurgeOldSnapshots(db, maxAge); err != nil {
					slog.Warn("metrics purge failed", "err", err)
				}
			}
		}
	}()
}
