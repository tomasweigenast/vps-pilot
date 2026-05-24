package cron

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// ReadCrontab returns the raw crontab text for the given user.
// Returns an empty string (no error) if the user has no crontab yet.
func ReadCrontab(user string) (string, error) {
	args := []string{"-l"}
	if user != "" {
		args = append(args, "-u", user)
	}
	cmd := exec.Command("crontab", args...)
	out, err := cmd.Output()
	if err != nil {
		// "no crontab for <user>" is a non-fatal exit code 1.
		if exitErr, ok := err.(*exec.ExitError); ok {
			msg := strings.ToLower(string(exitErr.Stderr))
			if strings.Contains(msg, "no crontab") {
				return "", nil
			}
		}
		return "", fmt.Errorf("crontab -l: %w", err)
	}
	return string(out), nil
}

// WriteCrontab replaces the crontab for the given user with the provided text.
func WriteCrontab(user string, content string) error {
	// Ensure file ends with newline.
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	args := []string{"-"}
	if user != "" {
		args = append(args, "-u", user)
	}
	cmd := exec.Command("crontab", args...)
	cmd.Stdin = bytes.NewBufferString(content)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("crontab -: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// ListCronUsers returns a list of system users that could have crontabs.
// It reads /etc/passwd and includes users whose shell is not /sbin/nologin,
// /usr/sbin/nologin, /bin/false, or similar non-interactive shells.
func ListCronUsers() []string {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return nil
	}
	defer f.Close()

	noLoginShells := map[string]bool{
		"/sbin/nologin":      true,
		"/usr/sbin/nologin":  true,
		"/bin/false":         true,
		"/dev/null":          true,
		"/bin/sync":          true,
		"/usr/bin/nologin":   true,
		"":                   true,
	}

	var users []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) < 7 {
			continue
		}
		username := parts[0]
		shell := parts[6]
		if noLoginShells[shell] {
			continue
		}
		users = append(users, username)
	}
	return users
}
