package api

import (
	"database/sql"
	"sync"

	"github.com/tomasweigenast/vps-pilot/internal/docker"
)

type dockerHandler struct {
	manager    *docker.Manager
	database   *sql.DB
	statsCache sync.Map // map[string][]docker.ContainerStat
}
