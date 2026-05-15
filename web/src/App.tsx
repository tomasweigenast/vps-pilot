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
import { AuditLogs } from "@/pages/AuditLogs";
import { ContainerFiles } from "@/pages/ContainerFiles";
import { ContainerShell } from "@/pages/ContainerShell";
import { ApiError } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";

const ProjectEditor = lazy(() =>
  import("@/pages/ProjectEditor").then((m) => ({ default: m.ProjectEditor }))
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
              <Route path="projects/:name/edit" element={<Suspense fallback={null}><ProjectEditor /></Suspense>} />
              <Route path="projects/:name/logs" element={<ProjectLogs />} />
              <Route path="system" element={<System />} />
              <Route path="logs" element={<Logs />} />
              <Route path="files" element={<Files />} />
              <Route path="audit" element={<AuditLogs />} />
              <Route path="projects/:name/containers/:id/files" element={<ContainerFiles />} />
              <Route path="projects/:name/containers/:id/shell" element={<ContainerShell />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
