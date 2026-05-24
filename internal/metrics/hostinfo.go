package metrics

import (
	"context"
	"fmt"

	"github.com/moby/moby/client"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

// HostInfo contains static information about the host machine and Docker engine.
type HostInfo struct {
	Hostname             string      `json:"hostname"`
	OS                   string      `json:"os"`
	Platform             string      `json:"platform"`
	PlatformVersion      string      `json:"platformVersion"`
	KernelVersion        string      `json:"kernelVersion"`
	KernelArch           string      `json:"kernelArch"`
	UptimeSeconds        uint64      `json:"uptimeSeconds"`
	BootTime             uint64      `json:"bootTime"`
	TotalCPU             int         `json:"totalCpu"`
	TotalMemoryBytes     uint64      `json:"totalMemoryBytes"`
	VirtualizationSystem string      `json:"virtualizationSystem,omitempty"`
	DockerVersion        string      `json:"dockerVersion,omitempty"`
	EngineInfo           *EngineInfo `json:"engineInfo,omitempty"`
}

// EngineInfo contains Docker Engine details.
type EngineInfo struct {
	APIVersion        string   `json:"apiVersion"`
	RootDir           string   `json:"rootDir"`
	StorageDriver     string   `json:"storageDriver"`
	LoggingDriver     string   `json:"loggingDriver"`
	VolumePlugins     []string `json:"volumePlugins"`
	NetworkPlugins    []string `json:"networkPlugins"`
	ContainersRunning int      `json:"containersRunning"`
	ContainersStopped int      `json:"containersStopped"`
	ImageCount        int      `json:"imageCount"`
}

// CollectHostInfo gathers static host and Docker engine information.
// The Docker client may be nil (engine info will be omitted).
func CollectHostInfo(ctx context.Context, dockerClient *client.Client) (*HostInfo, error) {
	info := &HostInfo{}

	hi, err := host.InfoWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("host info: %w", err)
	}

	info.Hostname = hi.Hostname
	info.OS = hi.OS
	info.Platform = hi.Platform
	info.PlatformVersion = hi.PlatformVersion
	info.KernelVersion = hi.KernelVersion
	info.KernelArch = hi.KernelArch
	info.UptimeSeconds = hi.Uptime
	info.BootTime = hi.BootTime
	info.VirtualizationSystem = hi.VirtualizationSystem

	// CPU count (logical cores)
	if count, err := cpu.CountsWithContext(ctx, true); err == nil {
		info.TotalCPU = count
	}

	// Total physical RAM
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		info.TotalMemoryBytes = vm.Total
	}

	if dockerClient != nil {
		// Info() returns full engine details
		if di, err := dockerClient.Info(ctx, client.InfoOptions{}); err == nil {
			info.DockerVersion = di.Info.ServerVersion
			info.EngineInfo = &EngineInfo{
				RootDir:           di.Info.DockerRootDir,
				StorageDriver:     di.Info.Driver,
				LoggingDriver:     di.Info.LoggingDriver,
				ContainersRunning: di.Info.ContainersRunning,
				ContainersStopped: di.Info.ContainersStopped,
				ImageCount:        di.Info.Images,
				VolumePlugins:     di.Info.Plugins.Volume,
				NetworkPlugins:    di.Info.Plugins.Network,
			}
			// API version comes from ServerVersion
			if sv, err2 := dockerClient.ServerVersion(ctx, client.ServerVersionOptions{}); err2 == nil {
				info.EngineInfo.APIVersion = sv.APIVersion
			}
		} else {
			// Fallback: at least get the version
			if sv, err2 := dockerClient.ServerVersion(ctx, client.ServerVersionOptions{}); err2 == nil {
				info.DockerVersion = sv.Version
			}
		}
	}

	return info, nil
}
