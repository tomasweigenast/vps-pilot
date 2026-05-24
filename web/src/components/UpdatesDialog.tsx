import { ArrowUpCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import type { UpdateStatus } from "@/api/projects";

export function UpdatesDialog({ projectName, status, open, onClose, onDeploy }: {
  projectName: string;
  status: UpdateStatus;
  open: boolean;
  onClose: () => void;
  onDeploy: () => void;
}) {
  const updatedServices = Object.entries(status.services).filter(([, hasUpdate]) => hasUpdate);
  const upToDateServices = Object.entries(status.services).filter(([, hasUpdate]) => !hasUpdate);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="size-4 text-amber-500" />
            Updates available — {projectName}
          </DialogTitle>
          <DialogDescription>
            New image versions are available for the following services.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {updatedServices.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Has updates</p>
              <div className="space-y-1">
                {updatedServices.map(([service]) => (
                  <div key={service} className="flex items-center gap-2 rounded px-2 py-1.5 bg-amber-500/10 border border-amber-500/20">
                    <ArrowUpCircle className="size-3.5 text-amber-500 shrink-0" />
                    <span className="text-sm font-mono">{service}</span>
                    <span className="ml-auto text-xs text-amber-500">update available</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {upToDateServices.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Up to date</p>
              <div className="space-y-1">
                {upToDateServices.map(([service]) => (
                  <div key={service} className="flex items-center gap-2 rounded px-2 py-1.5 bg-secondary/50">
                    <span className="size-1.5 rounded-full bg-green-500 shrink-0" />
                    <span className="text-sm font-mono text-muted-foreground">{service}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded hover:bg-secondary transition-colors">
            Cancel
          </button>
          <button
            onClick={() => { onClose(); onDeploy(); }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <ArrowUpCircle className="size-3.5" />
            Deploy updates
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
