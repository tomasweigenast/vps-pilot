package docker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/moby/moby/client"
)

// --- Networks ---

type NetworkEndpoint struct {
	Name    string `json:"name"`
	IP      string `json:"ip"`
	MacAddr string `json:"macAddr"`
}

type NetworkIPAMConfig struct {
	Subnet  string `json:"subnet"`
	Gateway string `json:"gateway"`
}

type NetworkSummary struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Driver            string            `json:"driver"`
	Scope             string            `json:"scope"`
	Internal          bool              `json:"internal"`
	Labels            map[string]string `json:"labels"`
	AssociatedProject string            `json:"associatedProject"`
	InUse             bool              `json:"inUse"`
	Created           time.Time         `json:"created"`
}

type NetworkDetail struct {
	NetworkSummary
	IPAMConfigs []NetworkIPAMConfig `json:"ipamConfigs"`
	Options     map[string]string   `json:"options"`
	Containers  []NetworkEndpoint   `json:"containers"`
}

func (m *Manager) listNetworks(ctx context.Context, f client.Filters) ([]NetworkSummary, error) {
	result, err := m.docker.NetworkList(ctx, client.NetworkListOptions{Filters: f})
	if err != nil {
		return nil, err
	}
	var out []NetworkSummary
	for _, n := range result.Items {
		inUse := false
		detail, err := m.docker.NetworkInspect(ctx, n.ID, client.NetworkInspectOptions{})
		if err == nil {
			inUse = len(detail.Network.Containers) > 0
		}
		out = append(out, NetworkSummary{
			ID:                n.ID,
			Name:              n.Name,
			Driver:            n.Driver,
			Scope:             n.Scope,
			Internal:          n.Internal,
			Labels:            n.Labels,
			AssociatedProject: n.Labels["com.docker.compose.project"],
			InUse:             inUse,
			Created:           n.Created,
		})
	}
	return out, nil
}

func (m *Manager) ListAllNetworks(ctx context.Context) ([]NetworkSummary, error) {
	return m.listNetworks(ctx, nil)
}

func (m *Manager) ListProjectNetworks(ctx context.Context, projectName string) ([]NetworkSummary, error) {
	f := make(client.Filters).Add("label", "com.docker.compose.project="+projectName)
	return m.listNetworks(ctx, f)
}

func (m *Manager) InspectNetwork(ctx context.Context, id string) (*NetworkDetail, error) {
	result, err := m.docker.NetworkInspect(ctx, id, client.NetworkInspectOptions{Verbose: true})
	if err != nil {
		return nil, err
	}
	n := result.Network

	var ipamCfgs []NetworkIPAMConfig
	for _, cfg := range n.IPAM.Config {
		ipamCfgs = append(ipamCfgs, NetworkIPAMConfig{
			Subnet:  cfg.Subnet.String(),
			Gateway: cfg.Gateway.String(),
		})
	}

	var containers []NetworkEndpoint
	for _, ep := range n.Containers {
		mac := ""
		if hw := ep.MacAddress; hw != nil {
			mac = hw.String()
		}
		containers = append(containers, NetworkEndpoint{
			Name:    ep.Name,
			IP:      ep.IPv4Address.Addr().String(),
			MacAddr: mac,
		})
	}

	d := &NetworkDetail{
		NetworkSummary: NetworkSummary{
			ID:                n.ID,
			Name:              n.Name,
			Driver:            n.Driver,
			Scope:             n.Scope,
			Internal:          n.Internal,
			Labels:            n.Labels,
			AssociatedProject: n.Labels["com.docker.compose.project"],
			InUse:             len(n.Containers) > 0,
			Created:           n.Created,
		},
		IPAMConfigs: ipamCfgs,
		Options:     n.Options,
		Containers:  containers,
	}
	return d, nil
}

// --- Volumes ---

type VolumeSummary struct {
	Name              string            `json:"name"`
	Driver            string            `json:"driver"`
	Mountpoint        string            `json:"mountpoint"`
	Labels            map[string]string `json:"labels"`
	AssociatedProject string            `json:"associatedProject"`
	InUse             bool              `json:"inUse"`
	CreatedAt         string            `json:"createdAt"`
}

type VolumeDetail struct {
	VolumeSummary
	Options   map[string]string `json:"options"`
	MountedBy []string          `json:"mountedBy"`
}

func (m *Manager) listVolumes(ctx context.Context, f client.Filters) ([]VolumeSummary, error) {
	result, err := m.docker.VolumeList(ctx, client.VolumeListOptions{Filters: f})
	if err != nil {
		return nil, err
	}
	inUse := m.volumesInUse(ctx)
	var out []VolumeSummary
	for _, v := range result.Items {
		out = append(out, VolumeSummary{
			Name:              v.Name,
			Driver:            v.Driver,
			Mountpoint:        v.Mountpoint,
			Labels:            v.Labels,
			AssociatedProject: v.Labels["com.docker.compose.project"],
			InUse:             inUse[v.Name],
			CreatedAt:         v.CreatedAt,
		})
	}
	return out, nil
}

func (m *Manager) ListAllVolumes(ctx context.Context) ([]VolumeSummary, error) {
	return m.listVolumes(ctx, nil)
}

func (m *Manager) ListProjectVolumes(ctx context.Context, projectName string) ([]VolumeSummary, error) {
	f := make(client.Filters).Add("label", "com.docker.compose.project="+projectName)
	return m.listVolumes(ctx, f)
}

func (m *Manager) InspectVolume(ctx context.Context, name string) (*VolumeDetail, error) {
	result, err := m.docker.VolumeInspect(ctx, name, client.VolumeInspectOptions{})
	if err != nil {
		return nil, err
	}
	v := result.Volume

	mountedBy := m.containersMountingVolume(ctx, name)

	d := &VolumeDetail{
		VolumeSummary: VolumeSummary{
			Name:              v.Name,
			Driver:            v.Driver,
			Mountpoint:        v.Mountpoint,
			Labels:            v.Labels,
			AssociatedProject: v.Labels["com.docker.compose.project"],
			InUse:             len(mountedBy) > 0,
			CreatedAt:         v.CreatedAt,
		},
		Options:   v.Options,
		MountedBy: mountedBy,
	}
	return d, nil
}

func (m *Manager) volumesInUse(ctx context.Context) map[string]bool {
	result := map[string]bool{}
	containers, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: false})
	if err != nil {
		return result
	}
	for _, c := range containers.Items {
		for _, mount := range c.Mounts {
			if mount.Name != "" {
				result[mount.Name] = true
			}
		}
	}
	return result
}

func (m *Manager) containersMountingVolume(ctx context.Context, volumeName string) []string {
	f := make(client.Filters).Add("volume", volumeName)
	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: f})
	if err != nil {
		return nil
	}
	var names []string
	for _, c := range result.Items {
		name := c.ID[:12]
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		names = append(names, name)
	}
	return names
}

// --- Images ---

type ImageSummary struct {
	ID       string   `json:"id"`
	RepoTags []string `json:"repoTags"`
	Size     int64    `json:"size"`
	Created  int64    `json:"created"`
	InUse    bool     `json:"inUse"`
}

func (m *Manager) ListAllImages(ctx context.Context) ([]ImageSummary, error) {
	// Collect all image IDs in use by any container
	containers, _ := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true})
	usedIDs := map[string]bool{}
	for _, c := range containers.Items {
		usedIDs[c.ImageID] = true
		if len(c.ImageID) >= 19 {
			usedIDs[c.ImageID[7:19]] = true
		}
	}

	allImages, err := m.docker.ImageList(ctx, client.ImageListOptions{All: false})
	if err != nil {
		return nil, err
	}
	var out []ImageSummary
	for _, img := range allImages.Items {
		shortID := img.ID
		if strings.HasPrefix(img.ID, "sha256:") && len(img.ID) >= 19 {
			shortID = img.ID[7:19]
		}
		inUse := usedIDs[img.ID] || usedIDs[shortID]
		out = append(out, ImageSummary{
			ID:       shortID,
			RepoTags: img.RepoTags,
			Size:     img.Size,
			Created:  img.Created,
			InUse:    inUse,
		})
	}
	return out, nil
}

func (m *Manager) ListProjectImages(ctx context.Context, projectName string) ([]ImageSummary, error) {
	f := make(client.Filters).Add("label", "com.docker.compose.project="+projectName)
	containers, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: f})
	if err != nil {
		return nil, err
	}

	// Collect image IDs and tags used by project containers
	usedIDs := map[string]bool{}
	usedTags := map[string]bool{}
	for _, c := range containers.Items {
		if c.ImageID != "" {
			usedIDs[c.ImageID] = true
			if len(c.ImageID) >= 19 {
				usedIDs[c.ImageID[7:19]] = true // short ID after sha256:
			}
		}
		usedTags[c.Image] = true
	}

	allImages, err := m.docker.ImageList(ctx, client.ImageListOptions{All: false})
	if err != nil {
		return nil, err
	}

	var out []ImageSummary
	for _, img := range allImages.Items {
		used := usedIDs[img.ID]
		if !used {
			for _, tag := range img.RepoTags {
				if usedTags[tag] {
					used = true
					break
				}
			}
		}
		if !used {
			continue
		}
		shortID := img.ID
		if strings.HasPrefix(img.ID, "sha256:") && len(img.ID) >= 19 {
			shortID = img.ID[7:19]
		}
		out = append(out, ImageSummary{
			ID:       shortID,
			RepoTags: img.RepoTags,
			Size:     img.Size,
			Created:  img.Created,
			InUse:    true,
		})
	}
	return out, nil
}

func (m *Manager) RemoveImage(ctx context.Context, id string, force bool) error {
	_, err := m.docker.ImageRemove(ctx, id, client.ImageRemoveOptions{Force: force, PruneChildren: false})
	return err
}

// --- Network CRUD ---

// CreateNetworkRequest holds options for creating a Docker network.
type CreateNetworkRequest struct {
	Name     string            `json:"name"`
	Driver   string            `json:"driver"`   // bridge, overlay, macvlan, …
	Internal bool              `json:"internal"` // not connected to external network
	Options  map[string]string `json:"options"`
	Labels   map[string]string `json:"labels"`
}

func (m *Manager) CreateNetwork(ctx context.Context, req CreateNetworkRequest) (string, error) {
	if m.docker == nil {
		return "", ErrDockerUnavailable
	}
	driver := req.Driver
	if driver == "" {
		driver = "bridge"
	}
	result, err := m.docker.NetworkCreate(ctx, req.Name, client.NetworkCreateOptions{
		Driver:   driver,
		Internal: req.Internal,
		Options:  req.Options,
		Labels:   req.Labels,
	})
	if err != nil {
		return "", fmt.Errorf("create network: %w", err)
	}
	return result.ID, nil
}

func (m *Manager) DeleteNetwork(ctx context.Context, id string) error {
	if m.docker == nil {
		return ErrDockerUnavailable
	}
	_, err := m.docker.NetworkRemove(ctx, id, client.NetworkRemoveOptions{})
	if err != nil {
		return fmt.Errorf("remove network: %w", err)
	}
	return nil
}

func (m *Manager) ConnectContainerToNetwork(ctx context.Context, networkID, containerID string) error {
	if m.docker == nil {
		return ErrDockerUnavailable
	}
	_, err := m.docker.NetworkConnect(ctx, networkID, client.NetworkConnectOptions{Container: containerID})
	if err != nil {
		return fmt.Errorf("connect container to network: %w", err)
	}
	return nil
}

func (m *Manager) DisconnectContainerFromNetwork(ctx context.Context, networkID, containerID string, force bool) error {
	if m.docker == nil {
		return ErrDockerUnavailable
	}
	_, err := m.docker.NetworkDisconnect(ctx, networkID, client.NetworkDisconnectOptions{
		Container: containerID,
		Force:     force,
	})
	if err != nil {
		return fmt.Errorf("disconnect container from network: %w", err)
	}
	return nil
}

// --- Volume CRUD ---

// CreateVolumeRequest holds options for creating a Docker volume.
type CreateVolumeRequest struct {
	Name       string            `json:"name"`
	Driver     string            `json:"driver"` // local, …
	DriverOpts map[string]string `json:"driverOpts"`
	Labels     map[string]string `json:"labels"`
}

func (m *Manager) CreateVolume(ctx context.Context, req CreateVolumeRequest) (string, error) {
	if m.docker == nil {
		return "", ErrDockerUnavailable
	}
	result, err := m.docker.VolumeCreate(ctx, client.VolumeCreateOptions{
		Name:       req.Name,
		Driver:     req.Driver,
		DriverOpts: req.DriverOpts,
		Labels:     req.Labels,
	})
	if err != nil {
		return "", fmt.Errorf("create volume: %w", err)
	}
	return result.Volume.Name, nil
}

func (m *Manager) DeleteVolume(ctx context.Context, name string, force bool) error {
	if m.docker == nil {
		return ErrDockerUnavailable
	}
	_, err := m.docker.VolumeRemove(ctx, name, client.VolumeRemoveOptions{Force: force})
	if err != nil {
		return fmt.Errorf("remove volume: %w", err)
	}
	return nil
}

// --- Container Inspect ---

type ContainerHealthLog struct {
	Start    string `json:"start"`
	End      string `json:"end"`
	ExitCode int    `json:"exitCode"`
	Output   string `json:"output"`
}

type ContainerHealth struct {
	Status        string               `json:"status"`
	FailingStreak int                  `json:"failingStreak"`
	Log           []ContainerHealthLog `json:"log"`
}

type ContainerNetworkInfo struct {
	Name    string `json:"name"`
	IP      string `json:"ip"`
	Gateway string `json:"gateway"`
	Mac     string `json:"mac"`
}

type ContainerMount struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Mode        string `json:"mode"`
	RW          bool   `json:"rw"`
}

type ContainerPort struct {
	IP          string `json:"ip"`
	PrivatePort uint16 `json:"privatePort"`
	PublicPort  uint16 `json:"publicPort"`
	Type        string `json:"type"`
}

type ContainerDetailState struct {
	Status     string           `json:"status"`
	Running    bool             `json:"running"`
	Paused     bool             `json:"paused"`
	Restarting bool             `json:"restarting"`
	ExitCode   int              `json:"exitCode"`
	StartedAt  string           `json:"startedAt"`
	FinishedAt string           `json:"finishedAt"`
	Health     *ContainerHealth `json:"health,omitempty"`
}

type ContainerInspectResult struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Image         string                 `json:"image"`
	State         ContainerDetailState   `json:"state"`
	Command       []string               `json:"command"`
	Entrypoint    []string               `json:"entrypoint"`
	Env           []string               `json:"env"`
	Labels        map[string]string      `json:"labels"`
	Networks      []ContainerNetworkInfo `json:"networks"`
	Mounts        []ContainerMount       `json:"mounts"`
	Ports         []ContainerPort        `json:"ports"`
	RestartPolicy string                 `json:"restartPolicy"`
	Platform      string                 `json:"platform"`
	Created       string                 `json:"created"`
}

func (m *Manager) InspectContainer(ctx context.Context, id string) (*ContainerInspectResult, error) {
	result, err := m.docker.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return nil, err
	}
	c := result.Container

	state := ContainerDetailState{}
	if c.State != nil {
		state.Status = string(c.State.Status)
		state.Running = c.State.Running
		state.Paused = c.State.Paused
		state.Restarting = c.State.Restarting
		state.ExitCode = c.State.ExitCode
		state.StartedAt = c.State.StartedAt
		state.FinishedAt = c.State.FinishedAt
		if c.State.Health != nil {
			h := &ContainerHealth{
				Status:        string(c.State.Health.Status),
				FailingStreak: c.State.Health.FailingStreak,
			}
			for _, l := range c.State.Health.Log {
				h.Log = append(h.Log, ContainerHealthLog{
					Start:    l.Start.Format(time.RFC3339),
					End:      l.End.Format(time.RFC3339),
					ExitCode: l.ExitCode,
					Output:   l.Output,
				})
			}
			state.Health = h
		}
	}

	var networks []ContainerNetworkInfo
	if c.NetworkSettings != nil {
		for netName, ep := range c.NetworkSettings.Networks {
			if ep == nil {
				continue
			}
			mac := ""
			if ep.MacAddress != nil {
				mac = ep.MacAddress.String()
			}
			networks = append(networks, ContainerNetworkInfo{
				Name:    netName,
				IP:      ep.IPAddress.String(),
				Gateway: ep.Gateway.String(),
				Mac:     mac,
			})
		}
	}

	var mounts []ContainerMount
	for _, mp := range c.Mounts {
		mounts = append(mounts, ContainerMount{
			Type:        string(mp.Type),
			Name:        mp.Name,
			Source:      mp.Source,
			Destination: mp.Destination,
			Mode:        mp.Mode,
			RW:          mp.RW,
		})
	}

	var ports []ContainerPort
	if c.NetworkSettings != nil {
		for portProto, bindings := range c.NetworkSettings.Ports {
			proto := string(portProto.Proto())
			privatePort := portProto.Num()
			if len(bindings) == 0 {
				ports = append(ports, ContainerPort{PrivatePort: privatePort, Type: proto})
				continue
			}
			for _, b := range bindings {
				pub := uint16(0)
				fmt.Sscanf(b.HostPort, "%d", &pub)
				ip := ""
				if b.HostIP.IsValid() {
					ip = b.HostIP.String()
				}
				ports = append(ports, ContainerPort{
					IP:          ip,
					PrivatePort: privatePort,
					PublicPort:  pub,
					Type:        proto,
				})
			}
		}
	}

	restartPolicy := ""
	if c.HostConfig != nil {
		restartPolicy = string(c.HostConfig.RestartPolicy.Name)
	}

	var cmd, entrypoint []string
	var env []string
	var labels map[string]string
	if c.Config != nil {
		cmd = c.Config.Cmd
		entrypoint = c.Config.Entrypoint
		env = c.Config.Env
		labels = c.Config.Labels
	}

	name := strings.TrimPrefix(c.Name, "/")

	shortID := c.ID
	if len(c.ID) >= 12 {
		shortID = c.ID[:12]
	}

	return &ContainerInspectResult{
		ID:            shortID,
		Name:          name,
		Image:         c.Image,
		State:         state,
		Command:       cmd,
		Entrypoint:    entrypoint,
		Env:           env,
		Labels:        labels,
		Networks:      networks,
		Mounts:        mounts,
		Ports:         ports,
		RestartPolicy: restartPolicy,
		Platform:      c.Platform,
		Created:       c.Created,
	}, nil
}
