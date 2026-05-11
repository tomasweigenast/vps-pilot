package metrics

import (
	"context"
	"log/slog"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

type Snapshot struct {
	Timestamp time.Time    `json:"timestamp"`
	CPU       CPUStats     `json:"cpu"`
	Memory    MemStats     `json:"memory"`
	Disks     []DiskStats  `json:"disks"`
	Network   []NetStats   `json:"network"`
}

type CPUStats struct {
	UsagePercent float64 `json:"usagePercent"`
	Cores        int     `json:"cores"`
}

type MemStats struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	UsedPercent float64 `json:"usedPercent"`
}

type DiskStats struct {
	Path        string  `json:"path"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"usedPercent"`
}

type NetStats struct {
	Interface string `json:"interface"`
	BytesSent uint64 `json:"bytesSent"`
	BytesRecv uint64 `json:"bytesRecv"`
	PacketsSent uint64 `json:"packetsSent"`
	PacketsRecv uint64 `json:"packetsRecv"`
}

func Collect(ctx context.Context) (*Snapshot, error) {
	snap := &Snapshot{Timestamp: time.Now()}

	percents, err := cpu.PercentWithContext(ctx, 0, false)
	if err == nil && len(percents) > 0 {
		snap.CPU.UsagePercent = percents[0]
	}
	counts, _ := cpu.CountsWithContext(ctx, true)
	snap.CPU.Cores = counts

	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		snap.Memory = MemStats{
			Total:       vm.Total,
			Used:        vm.Used,
			Available:   vm.Available,
			UsedPercent: vm.UsedPercent,
		}
	}

	parts, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		slog.Warn("disk partitions unavailable", "err", err)
	} else {
		for _, p := range parts {
			usage, err := disk.UsageWithContext(ctx, p.Mountpoint)
			if err != nil {
				slog.Debug("disk usage failed", "mount", p.Mountpoint, "err", err)
				continue
			}
			snap.Disks = append(snap.Disks, DiskStats{
				Path:        p.Mountpoint,
				Total:       usage.Total,
				Used:        usage.Used,
				Free:        usage.Free,
				UsedPercent: usage.UsedPercent,
			})
		}
	}

	ifaces, err := net.IOCountersWithContext(ctx, true)
	if err == nil {
		for _, iface := range ifaces {
			if iface.Name == "lo" {
				continue
			}
			snap.Network = append(snap.Network, NetStats{
				Interface:   iface.Name,
				BytesSent:   iface.BytesSent,
				BytesRecv:   iface.BytesRecv,
				PacketsSent: iface.PacketsSent,
				PacketsRecv: iface.PacketsRecv,
			})
		}
	}

	slog.Debug("metrics collected", "disks", len(snap.Disks), "ifaces", len(snap.Network))
	return snap, nil
}
