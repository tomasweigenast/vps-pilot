import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { login } from "@/api/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Server, ArrowRight } from "lucide-react";

const schema = z.object({
  username: z.string().min(1, "Required"),
  password: z.string().min(1, "Required"),
});
type FormData = z.infer<typeof schema>;

export function Login() {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    try {
      await login(data);
      // Refetch auth state — LoginGuard redirects to /dashboard when resolved
      await qc.refetchQueries({ queryKey: ["me"] });
    } catch {
      toast.error("Invalid credentials");
    }
  }

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center bg-background p-4">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 size-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-8 shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
              <Server className="size-5 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold tracking-tight">VPS Manager</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Sign in to your server</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Username
              </label>
              <input
                {...register("username")}
                autoComplete="username"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-0 transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-1 focus:ring-primary/30"
                placeholder="admin"
              />
              {errors.username && (
                <p className="text-xs text-destructive">{errors.username.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Password
              </label>
              <input
                {...register("password")}
                type="password"
                autoComplete="current-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-0 transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-1 focus:ring-primary/30"
                placeholder="••••••••"
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="live-dot size-1.5 rounded-full bg-current inline-block" />
              ) : (
                <>
                  Sign in
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground/50">
          VPS Manager — secure server management
        </p>
      </div>
    </div>
  );
}
