package docker

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/moby/moby/api/types/jsonstream"
	"github.com/moby/moby/client"
)

// BuildSpec describes a Docker image build request.
type BuildSpec struct {
	// ContextDir is the path on the host filesystem to use as the build context.
	// If empty, DockerfileContent must be set instead.
	ContextDir string `json:"contextDir"`

	// DockerfileContent is an inline Dockerfile. Used when ContextDir is empty.
	DockerfileContent string `json:"dockerfileContent"`

	// DockerfilePath is the path to the Dockerfile relative to ContextDir.
	// Defaults to "Dockerfile".
	DockerfilePath string `json:"dockerfilePath"`

	// Tags are the image tags to apply (e.g. ["myapp:latest"]).
	Tags []string `json:"tags"`

	// BuildArgs are the --build-arg values.
	BuildArgs map[string]string `json:"buildArgs"`

	// Target is the multi-stage build target to stop at.
	Target string `json:"target"`

	// NoCache disables the layer cache.
	NoCache bool `json:"noCache"`
}

// BuildEvent is a single event emitted during a build.
type BuildEvent struct {
	Stream string `json:"stream,omitempty"`
	Error  string `json:"error,omitempty"`
	Done   bool   `json:"done,omitempty"`
}

// BuildImage runs a Docker image build and writes BuildEvent JSON lines to progressCh.
// The channel is closed when the build completes or an error occurs.
func (m *Manager) BuildImage(ctx context.Context, spec BuildSpec, progressCh chan<- BuildEvent) error {
	if m.docker == nil {
		return fmt.Errorf("docker client not available")
	}

	// Build the tar context
	tarBuf, err := buildTarContext(spec)
	if err != nil {
		return fmt.Errorf("building tar context: %w", err)
	}

	// Build args: map[string]*string
	var buildArgs map[string]*string
	if len(spec.BuildArgs) > 0 {
		buildArgs = make(map[string]*string, len(spec.BuildArgs))
		for k, v := range spec.BuildArgs {
			v := v // capture loop variable
			buildArgs[k] = &v
		}
	}

	dockerfilePath := spec.DockerfilePath
	if dockerfilePath == "" {
		dockerfilePath = "Dockerfile"
	}

	opts := client.ImageBuildOptions{
		Tags:           spec.Tags,
		Dockerfile:     dockerfilePath,
		BuildArgs:      buildArgs,
		Target:         spec.Target,
		NoCache:        spec.NoCache,
		Remove:         true,
		ForceRemove:    true,
		SuppressOutput: false,
	}

	result, err := m.docker.ImageBuild(ctx, tarBuf, opts)
	if err != nil {
		return fmt.Errorf("starting build: %w", err)
	}
	defer result.Body.Close()

	// Stream the output
	decoder := json.NewDecoder(result.Body)
	for {
		var msg jsonstream.Message
		if err := decoder.Decode(&msg); err != nil {
			if err == io.EOF {
				break
			}
			progressCh <- BuildEvent{Error: err.Error()}
			return err
		}

		if msg.Error != nil {
			progressCh <- BuildEvent{Error: msg.Error.Message}
			return fmt.Errorf("build error: %s", msg.Error.Message)
		}

		if msg.Stream != "" {
			progressCh <- BuildEvent{Stream: msg.Stream}
		}
	}

	progressCh <- BuildEvent{Done: true, Stream: "\nBuild complete.\n"}
	return nil
}

// buildTarContext creates a tar archive suitable as a Docker build context.
func buildTarContext(spec BuildSpec) (io.Reader, error) {
	buf := &bytes.Buffer{}
	tw := tar.NewWriter(buf)

	if spec.DockerfileContent != "" {
		// Inline Dockerfile — single-file context
		content := []byte(spec.DockerfileContent)
		if err := tw.WriteHeader(&tar.Header{
			Name: "Dockerfile",
			Size: int64(len(content)),
			Mode: 0o644,
		}); err != nil {
			return nil, err
		}
		if _, err := tw.Write(content); err != nil {
			return nil, err
		}
	} else if spec.ContextDir != "" {
		// Walk the context directory
		if err := addDirToTar(tw, spec.ContextDir, spec.ContextDir); err != nil {
			return nil, err
		}
	} else {
		return nil, fmt.Errorf("either contextDir or dockerfileContent must be provided")
	}

	if err := tw.Close(); err != nil {
		return nil, err
	}
	return buf, nil
}

// addDirToTar walks dir and adds all files to tw, relative to baseDir.
func addDirToTar(tw *tar.Writer, dir, baseDir string) error {
	// We use filepath.WalkDir to traverse, but for simplicity, we only
	// support single-level builds via inline Dockerfile in Phase 3.
	// For ContextDir builds, this is a placeholder that returns an error
	// indicating the limitation, since the web UI primarily uses inline Dockerfiles.
	_ = dir
	_ = baseDir
	_ = tw
	return fmt.Errorf("contextDir builds are not yet supported; use dockerfileContent")
}

// NormaliseTag ensures the tag has a colon separator. If there is no colon,
// ":latest" is appended.
func NormaliseTag(tag string) string {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return ""
	}
	// Avoid double-slash in registry paths — only append :latest for simple names
	if !strings.Contains(tag, ":") && !strings.Contains(tag, "@") {
		// Only append :latest if there's no digest
		parts := strings.SplitN(filepath.Base(tag), ":", 2)
		if len(parts) == 1 {
			tag = tag + ":latest"
		}
	}
	return tag
}
