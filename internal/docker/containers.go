package docker

import (
	"context"
	"fmt"
	"net/netip"
	"strings"

	mobyContainer "github.com/moby/moby/api/types/container"
	mobyNetwork "github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

// StandaloneContainer is a summary of a single host container suitable for API responses.
type StandaloneContainer struct {
	ID      string   `json:"id"`
	Names   []string `json:"names"`
	Image   string   `json:"image"`
	State   string   `json:"state"`
	Status  string   `json:"status"`
	Created int64    `json:"created"`
	Ports   []PortMapping `json:"ports"`
	Labels  map[string]string `json:"labels"`
	// ComposeProject is non-empty when the container belongs to a compose project.
	ComposeProject string `json:"composeProject,omitempty"`
}

// PortMapping is a simplified port mapping entry.
type PortMapping struct {
	HostIP      string `json:"hostIP,omitempty"`
	HostPort    uint16 `json:"hostPort,omitempty"`
	ContainerPort uint16 `json:"containerPort"`
	Protocol    string `json:"protocol"`
}

// CreateContainerRequest holds parameters for creating a standalone container.
type CreateContainerRequest struct {
	Image       string            `json:"image"`
	Name        string            `json:"name"`
	Env         []string          `json:"env"`         // KEY=VALUE pairs
	Ports       []PortSpec        `json:"ports"`       // host:container/proto
	Volumes     []string          `json:"volumes"`     // host:container[:mode]
	RestartPolicy string          `json:"restartPolicy"` // no|always|unless-stopped|on-failure
	Entrypoint  []string          `json:"entrypoint,omitempty"`
	Cmd         []string          `json:"cmd,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
}

// PortSpec is a port mapping specification.
type PortSpec struct {
	HostPort      string `json:"hostPort"`
	ContainerPort string `json:"containerPort"`
	Protocol      string `json:"protocol"` // "tcp" or "udp", default "tcp"
}

// ListAllContainers returns all containers on the host (including stopped ones when all=true).
func (m *Manager) ListAllContainers(ctx context.Context, all bool) ([]StandaloneContainer, error) {
	if m.docker == nil {
		return nil, ErrDockerUnavailable
	}
	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: all})
	if err != nil {
		return nil, fmt.Errorf("list containers: %w", err)
	}

	out := make([]StandaloneContainer, 0, len(result.Items))
	for _, c := range result.Items {
		var ports []PortMapping
		for _, p := range c.Ports {
			pm := PortMapping{
				ContainerPort: p.PrivatePort,
				Protocol:      p.Type,
				HostPort:      p.PublicPort,
			}
			if p.IP.IsValid() {
				pm.HostIP = p.IP.String()
			}
			ports = append(ports, pm)
		}

		out = append(out, StandaloneContainer{
			ID:             c.ID[:min(12, len(c.ID))],
			Names:          c.Names,
			Image:          c.Image,
			State:          string(c.State),
			Status:         c.Status,
			Created:        c.Created,
			Ports:          ports,
			Labels:         c.Labels,
			ComposeProject: c.Labels["com.docker.compose.project"],
		})
	}
	return out, nil
}

// CreateAndStartContainer creates a new container and starts it.
func (m *Manager) CreateAndStartContainer(ctx context.Context, req CreateContainerRequest) (string, error) {
	if m.docker == nil {
		return "", ErrDockerUnavailable
	}

	// Build exposed ports + port bindings
	exposedPorts := mobyNetwork.PortSet{}
	portBindings := mobyNetwork.PortMap{}

	for _, p := range req.Ports {
		proto := p.Protocol
		if proto == "" {
			proto = "tcp"
		}
		containerPortStr := p.ContainerPort + "/" + proto
		cp, err := mobyNetwork.ParsePort(containerPortStr)
		if err != nil {
			return "", fmt.Errorf("invalid container port %q: %w", p.ContainerPort, err)
		}
		exposedPorts[cp] = struct{}{}

		binding := mobyNetwork.PortBinding{HostPort: p.HostPort}
		portBindings[cp] = append(portBindings[cp], binding)
	}

	// Build volume binds (host:container[:mode])
	binds := req.Volumes

	// Restart policy
	restartPolicy := mobyContainer.RestartPolicy{}
	switch req.RestartPolicy {
	case "always":
		restartPolicy.Name = mobyContainer.RestartPolicyAlways
	case "unless-stopped":
		restartPolicy.Name = mobyContainer.RestartPolicyUnlessStopped
	case "on-failure":
		restartPolicy.Name = mobyContainer.RestartPolicyOnFailure
	default:
		restartPolicy.Name = mobyContainer.RestartPolicyDisabled
	}

	cfg := &mobyContainer.Config{
		Image:        req.Image,
		Env:          req.Env,
		ExposedPorts: exposedPorts,
		Labels:       req.Labels,
	}
	if len(req.Entrypoint) > 0 {
		cfg.Entrypoint = req.Entrypoint
	}
	if len(req.Cmd) > 0 {
		cfg.Cmd = req.Cmd
	}

	hostCfg := &mobyContainer.HostConfig{
		Binds:         binds,
		PortBindings:  portBindings,
		RestartPolicy: restartPolicy,
	}

	created, err := m.docker.ContainerCreate(ctx, client.ContainerCreateOptions{
		Name:       req.Name,
		Config:     cfg,
		HostConfig: hostCfg,
	})
	if err != nil {
		return "", fmt.Errorf("create container: %w", err)
	}

	_, err = m.docker.ContainerStart(ctx, created.ID, client.ContainerStartOptions{})
	if err != nil {
		// Attempt cleanup on start failure
		_ = removeContainer(ctx, m.docker, created.ID)
		return "", fmt.Errorf("start container: %w", err)
	}

	return created.ID[:min(12, len(created.ID))], nil
}

// RemoveContainer stops and removes a container by ID or name.
func (m *Manager) RemoveContainer(ctx context.Context, id string) error {
	if m.docker == nil {
		return ErrDockerUnavailable
	}
	return removeContainer(ctx, m.docker, id)
}

func removeContainer(ctx context.Context, dockerClient *client.Client, id string) error {
	// Stop first (ignore error — container may already be stopped)
	_, _ = dockerClient.ContainerStop(ctx, id, client.ContainerStopOptions{})
	_, err := dockerClient.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: true})
	if err != nil {
		return fmt.Errorf("remove container %s: %w", id, err)
	}
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// formatPortMappings converts port mappings to a human-readable string.
func formatPortMappings(ports []PortMapping) string {
	var sb strings.Builder
	for i, p := range ports {
		if i > 0 {
			sb.WriteString(", ")
		}
		if p.HostPort > 0 {
			if p.HostIP != "" && p.HostIP != "0.0.0.0" {
				sb.WriteString(p.HostIP + ":")
			}
			fmt.Fprintf(&sb, "%d->%d/%s", p.HostPort, p.ContainerPort, p.Protocol)
		} else {
			fmt.Fprintf(&sb, "%d/%s", p.ContainerPort, p.Protocol)
		}
	}
	return sb.String()
}

// ErrDockerUnavailable is returned when the Docker client is not connected.
var ErrDockerUnavailable = fmt.Errorf("docker client unavailable")

// Ensure netip is used (avoid import cycle when netip.Addr is used in PortMapping)
var _ = netip.Addr{}
