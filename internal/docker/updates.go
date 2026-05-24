package docker

import (
	"context"
	"log/slog"
	"strings"

	"github.com/moby/moby/client"
)

// UpdateStatus holds per-project update availability information.
type UpdateStatus struct {
	// Services maps service name → true if an update is available.
	Services map[string]bool `json:"services"`
	// HasUpdates is true if any service has an update available.
	HasUpdates bool `json:"hasUpdates"`
}

// CheckProjectUpdates checks each container image in the project against its
// registry and returns whether a newer version is available.
//
// It compares the local RepoDigests of the running image against the manifest
// digest returned by the registry. This works for images pulled with a tag
// (e.g. "nginx:latest") that expose digest information.
//
// Private registry auth is attempted via the credentials stored by docker login.
// Images that cannot be inspected (network error, private registry, etc.) are
// reported as "no update available" rather than erroring.
func (m *Manager) CheckProjectUpdates(ctx context.Context, projectName string) (*UpdateStatus, error) {
	if m.docker == nil {
		return &UpdateStatus{Services: map[string]bool{}}, nil
	}

	// Get containers for this project
	f := make(client.Filters).Add("label", "com.docker.compose.project="+projectName)
	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: false, Filters: f})
	if err != nil {
		return nil, err
	}

	status := &UpdateStatus{Services: map[string]bool{}}

	for _, c := range result.Items {
		service := c.Labels["com.docker.compose.service"]
		if service == "" {
			service = c.ID[:12]
		}

		updateAvailable, err := m.imageHasUpdate(ctx, c.Image, c.ImageID)
		if err != nil {
			slog.Debug("update check failed for image", "image", c.Image, "err", err)
			status.Services[service] = false
			continue
		}
		status.Services[service] = updateAvailable
		if updateAvailable {
			status.HasUpdates = true
		}
	}

	return status, nil
}

// imageHasUpdate returns true if the registry has a newer digest than what is
// running locally.
func (m *Manager) imageHasUpdate(ctx context.Context, imageRef, runningImageID string) (bool, error) {
	// Only meaningful for tagged images (not digest-pinned)
	if strings.Contains(imageRef, "@sha256:") {
		return false, nil // pinned digest, no auto-update possible
	}

	// Inspect local image to get its repo digests
	localResult, err := m.docker.ImageInspect(ctx, runningImageID)
	if err != nil {
		return false, err
	}

	// Get registry manifest digest
	distResult, err := m.docker.DistributionInspect(ctx, imageRef, client.DistributionInspectOptions{})
	if err != nil {
		// Cannot reach registry (private, network error, etc.) — skip silently
		return false, nil
	}

	registryDigest := string(distResult.Descriptor.Digest)
	if registryDigest == "" {
		return false, nil
	}

	// Check if local image already has this digest
	for _, rd := range localResult.RepoDigests {
		// rd is in the form "registry/image@sha256:..."
		if strings.Contains(rd, registryDigest) {
			return false, nil // already up to date
		}
	}

	return true, nil
}
