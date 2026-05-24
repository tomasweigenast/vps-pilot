import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, HardDrive, Container, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getVolume, deleteVolume } from "@/api/docker";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

function InUseBadge({ inUse }: { inUse: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
      inUse
        ? "bg-green-500/10 text-green-400 ring-green-500/20"
        : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20"
    )}>
      <span className={cn("size-1.5 rounded-full", inUse ? "bg-green-400" : "bg-zinc-500")} />
      {inUse ? "In use" : "Unused"}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-4 py-2.5 border-b border-border">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-4 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <span className={cn("text-xs flex-1 break-all", mono && "font-mono")}>{value ?? "—"}</span>
    </div>
  );
}

export function VolumeDetail() {
  const { vol } = useParams<{ vol: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["volume-detail", vol],
    queryFn: () => getVolume(decodeURIComponent(vol!)),
  });

  const del = useMutation({
    mutationFn: () => deleteVolume(decodeURIComponent(vol!), false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["volumes"] });
      toast.success("Volume deleted");
      navigate("/volumes");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete volume"),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
        <span className="live-dot size-1.5 rounded-full bg-primary inline-block mr-2" />
        Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
        Failed to load volume details.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/volumes" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">{data.name}</h1>
            <p className="text-xs text-muted-foreground">{data.associatedProject || "—"}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <InUseBadge inUse={data.inUse} />
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Details">
          <KV label="Driver" value={data.driver} />
          <KV label="Scope" value="local" />
          <KV label="Mountpoint" value={data.mountpoint} mono />
          <KV label="Created" value={data.createdAt ? new Date(data.createdAt).toLocaleString() : "—"} />
          <KV label="Project" value={data.associatedProject || "—"} />
        </Section>

        <Section title={`Mounted by (${data.mountedBy?.length ?? 0})`}>
          {!data.mountedBy?.length ? (
            <p className="text-xs text-muted-foreground">Not currently mounted by any container.</p>
          ) : (
            <div className="space-y-1">
              {data.mountedBy.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1">
                  <Container className="size-3 text-muted-foreground" />
                  <span className="font-mono">{c}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {data.options && Object.keys(data.options).length > 0 && (
        <Section title="Options">
          {Object.entries(data.options).map(([k, v]) => (
            <div key={k} className="flex gap-3 py-1 border-b border-border/30 last:border-0">
              <span className="text-xs font-mono text-muted-foreground w-32 shrink-0">{k}</span>
              <span className="text-xs font-mono">{v}</span>
            </div>
          ))}
        </Section>
      )}

      {data.labels && Object.keys(data.labels).length > 0 && (
        <Section title="Labels">
          <div className="max-h-48 overflow-y-auto">
            {Object.entries(data.labels).map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1 border-b border-border/30 last:border-0">
                <span className="text-xs font-mono text-muted-foreground w-64 shrink-0 truncate">{k}</span>
                <span className="text-xs font-mono truncate flex-1">{v}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete volume?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently remove volume <span className="font-mono font-medium">{data.name}</span> and all its data.
              {data.inUse && (
                <span className="block mt-2 text-yellow-600 dark:text-yellow-400">
                  ⚠ This volume is currently mounted by running containers.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => del.mutate()}
              className="bg-destructive text-white hover:opacity-90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
