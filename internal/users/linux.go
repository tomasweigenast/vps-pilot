package users

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

type LinuxUser struct {
	Username string
	UID      int
	Shell    string
}

var nonLoginShells = map[string]bool{
	"/sbin/nologin":      true,
	"/bin/false":         true,
	"/usr/sbin/nologin":  true,
	"/bin/nologin":       true,
	"/usr/bin/nologin":   true,
	"/dev/null":          true,
}

// ListLoginable returns all users from /etc/passwd that can log in interactively.
// Includes root (UID 0) and users with UID >= 1000, excluding non-login shells.
func ListLoginable() ([]LinuxUser, error) {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var users []LinuxUser
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Split(line, ":")
		if len(fields) < 7 {
			continue
		}
		username := fields[0]
		uidStr := fields[2]
		shell := fields[6]

		uid, err := strconv.Atoi(uidStr)
		if err != nil {
			continue
		}
		if uid != 0 && uid < 1000 {
			continue
		}
		if nonLoginShells[shell] {
			continue
		}

		users = append(users, LinuxUser{
			Username: username,
			UID:      uid,
			Shell:    shell,
		})
	}
	return users, scanner.Err()
}
