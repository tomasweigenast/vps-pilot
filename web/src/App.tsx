import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/pages/AppLayout";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Projects } from "@/pages/Projects";
import { ProjectLogs } from "@/pages/ProjectLogs";
import { System } from "@/pages/System";
import { Logs } from "@/pages/Logs";
import { Files } from "@/pages/Files";
import { ApiError } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";

const ProjectEditor = lazy(() =>
  import("@/pages/ProjectEditor").then((m) => ({ default: m.ProjectEditor }))
);
const ProjectDetail = lazy(() =>
  import("@/pages/ProjectDetail").then((m) => ({ default: m.ProjectDetail }))
);
// Lazy-load heavy pages to keep the main bundle lean.
// ContainerShell pulls in xterm.js (~250 kB); splitting it saves the most.
const ContainerShell = lazy(() =>
  import("@/pages/ContainerShell").then((m) => ({ default: m.ContainerShell }))
);
const ContainerFiles = lazy(() =>
  import("@/pages/ContainerFiles").then((m) => ({ default: m.ContainerFiles }))
);
const AuditLogs = lazy(() =>
  import("@/pages/AuditLogs").then((m) => ({ default: m.AuditLogs }))
);
const Users = lazy(() =>
  import("@/pages/Users").then((m) => ({ default: m.Users }))
);
const Roles = lazy(() =>
  import("@/pages/Roles").then((m) => ({ default: m.Roles }))
);
const Setup = lazy(() =>
  import("@/pages/Setup").then((m) => ({ default: m.Setup }))
);
const ContainerDetail = lazy(() =>
  import("@/pages/ContainerDetail").then((m) => ({ default: m.ContainerDetail }))
);
const Networks = lazy(() =>
  import("@/pages/Networks").then((m) => ({ default: m.Networks }))
);
const NetworkDetail = lazy(() =>
  import("@/pages/NetworkDetail").then((m) => ({ default: m.NetworkDetail }))
);
const Volumes = lazy(() =>
  import("@/pages/Volumes").then((m) => ({ default: m.Volumes }))
);
const VolumeDetail = lazy(() =>
  import("@/pages/VolumeDetail").then((m) => ({ default: m.VolumeDetail }))
);
const Images = lazy(() =>
  import("@/pages/Images").then((m) => ({ default: m.Images }))
);
const Registries = lazy(() =>
  import("@/pages/Registries").then((m) => ({ default: m.Registries }))
);
const Secrets = lazy(() =>
  import("@/pages/Secrets").then((m) => ({ default: m.Secrets }))
);
const Containers = lazy(() =>
  import("@/pages/Containers").then((m) => ({ default: m.Containers }))
);
const Events = lazy(() =>
  import("@/pages/Events").then((m) => ({ default: m.Events }))
);
const Notifications = lazy(() =>
  import("@/pages/Notifications").then((m) => ({ default: m.Notifications }))
);
const Backup = lazy(() =>
  import("@/pages/Backup").then((m) => ({ default: m.Backup }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return count < 1;
      },
      staleTime: 30_000,
    },
  },
});


function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <span className="live-dot size-1.5 rounded-full bg-primary inline-block" />
          Connecting…
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Use replace so back button doesn't loop
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function LoginGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/setup"
              element={
                <Suspense fallback={null}>
                  <Setup />
                </Suspense>
              }
            />
            <Route
              path="/login"
              element={
                <LoginGuard>
                  <Login />
                </LoginGuard>
              }
            />
            <Route
              path="/"
              element={
                <AuthGuard>
                  <AppLayout />
                </AuthGuard>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/new" element={<Suspense fallback={null}><ProjectEditor /></Suspense>} />
              <Route path="projects/:name" element={<Suspense fallback={null}><ProjectDetail /></Suspense>} />
              <Route path="projects/:name/logs" element={<ProjectLogs />} />
              <Route path="system" element={<System />} />
              <Route path="logs" element={<Logs />} />
              <Route path="files" element={<Files />} />
              <Route path="audit" element={<Suspense fallback={null}><AuditLogs /></Suspense>} />
              <Route path="users" element={<Suspense fallback={null}><Users /></Suspense>} />
              <Route path="roles" element={<Suspense fallback={null}><Roles /></Suspense>} />
              <Route path="projects/:name/containers/:id/files" element={<Suspense fallback={null}><ContainerFiles /></Suspense>} />
              <Route path="projects/:name/containers/:id/shell" element={<Suspense fallback={null}><ContainerShell /></Suspense>} />
              <Route path="projects/:name/containers/:id" element={<Suspense fallback={null}><ContainerDetail /></Suspense>} />
              <Route path="networks" element={<Suspense fallback={null}><Networks /></Suspense>} />
              <Route path="networks/:networkID" element={<Suspense fallback={null}><NetworkDetail /></Suspense>} />
              <Route path="volumes" element={<Suspense fallback={null}><Volumes /></Suspense>} />
              <Route path="volumes/:vol" element={<Suspense fallback={null}><VolumeDetail /></Suspense>} />
              <Route path="images" element={<Suspense fallback={null}><Images /></Suspense>} />
              <Route path="registries" element={<Suspense fallback={null}><Registries /></Suspense>} />
              <Route path="secrets" element={<Suspense fallback={null}><Secrets /></Suspense>} />
              <Route path="containers" element={<Suspense fallback={null}><Containers /></Suspense>} />
              <Route path="events" element={<Suspense fallback={null}><Events /></Suspense>} />
              <Route path="notifications" element={<Suspense fallback={null}><Notifications /></Suspense>} />
              <Route path="backup" element={<Suspense fallback={null}><Backup /></Suspense>} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
