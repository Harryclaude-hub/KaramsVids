import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Shield,
  UserCheck,
  UserX,
  Users,
  Hourglass,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Search,
} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  component: AdminPortal,
});

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  status: string;
  created_at: string;
  approved_at: string | null;
};

function AdminPortal() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const usersQ = useQuery({
    queryKey: ["admin_users"],
    refetchInterval: 10_000, // Fallback, falls Realtime nicht durchkommt
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Profile[];
    },
  });

  const users = usersQ.data ?? [];

  // Live: neue Registrierungen sofort anzeigen + melden
  useEffect(() => {
    const channel = supabase
      .channel("admin-profiles")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "profiles" },
        (payload) => {
          const p = payload.new as { email?: string; status?: string };
          qc.invalidateQueries({ queryKey: ["admin_users"] });
          if (p.status !== "approved") {
            toast.info(`Neue Registrierung: ${p.email ?? "unbekannt"}`, { duration: 10000 });
          }
        },
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, () =>
        qc.invalidateQueries({ queryKey: ["admin_users"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // Auch ohne Realtime: wächst die Wartenden-Zahl, kurz melden
  const prevPendingRef = useRef<number | null>(null);
  useEffect(() => {
    const n = users.filter((u) => u.status === "pending").length;
    if (prevPendingRef.current !== null && n > prevPendingRef.current) {
      toast.info(`${n - prevPendingRef.current} neue Registrierung(en) warten auf Freigabe`, {
        duration: 8000,
      });
    }
    prevPendingRef.current = n;
  }, [users]);
  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");
  const rejected = users.filter((u) => u.status === "rejected");

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (u.email ?? "").toLowerCase().includes(q) || (u.display_name ?? "").toLowerCase().includes(q)
    );
  });

  async function setStatus(id: string, status: "approved" | "rejected" | "pending") {
    setBusyId(id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          status,
          approved_at: status === "approved" ? new Date().toISOString() : null,
          approved_by: status === "approved" ? user.id : null,
        } as never)
        .eq("id", id);
      if (error) throw error;
      toast.success(
        status === "approved"
          ? "Nutzer freigegeben"
          : status === "rejected"
            ? "Nutzer abgelehnt"
            : "Auf wartend zurückgesetzt",
      );
      qc.invalidateQueries({ queryKey: ["admin_users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Aktion fehlgeschlagen");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
          <Shield className="h-3 w-3" /> Admin-Portal
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Nutzerverwaltung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Jede Registrierung wartet hier auf deine Freigabe — ohne Freigabe kein Zugang zum Tool.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="Gesamt" value={users.length} />
        <StatCard
          icon={<Hourglass className="h-4 w-4 text-accent" />}
          label="Wartend"
          value={pending.length}
          highlight={pending.length > 0}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
          label="Freigegeben"
          value={approved.length}
        />
        <StatCard
          icon={<XCircle className="h-4 w-4 text-destructive" />}
          label="Abgelehnt"
          value={rejected.length}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Hourglass className="h-4 w-4 text-accent" /> Neue Registrierungen ({pending.length})
        </div>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Keine wartenden Registrierungen. Neue erscheinen hier automatisch.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.display_name ?? "—"}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{p.email}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    registriert: {new Date(p.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStatus(p.id, "approved")}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    <UserCheck className="h-3.5 w-3.5" /> Freigeben
                  </button>
                  <button
                    onClick={() => setStatus(p.id, "rejected")}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    <UserX className="h-3.5 w-3.5" /> Ablehnen
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4 text-muted-foreground" /> Alle Nutzer
          </div>
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="E-Mail oder Name suchen…"
              className="rounded-md border border-border bg-input py-1.5 pl-7 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-3 py-2">Nutzer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Rolle</th>
                <th className="px-3 py-2">Registriert</th>
                <th className="px-3 py-2 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.display_name ?? "—"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{p.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-2">
                    {p.role === "admin" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase text-primary">
                        <Shield className="h-2.5 w-2.5" /> Admin
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground">User</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.role !== "admin" && (
                      <div className="inline-flex gap-1">
                        {p.status !== "approved" && (
                          <button
                            onClick={() => setStatus(p.id, "approved")}
                            disabled={busyId === p.id}
                            title="Freigeben"
                            className="rounded-md border border-primary/50 p-1.5 text-primary hover:bg-primary/10 disabled:opacity-60"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {p.status !== "rejected" && (
                          <button
                            onClick={() => setStatus(p.id, "rejected")}
                            disabled={busyId === p.id}
                            title="Sperren/Ablehnen"
                            className="rounded-md border border-destructive/50 p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-60"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {p.status !== "pending" && (
                          <button
                            onClick={() => setStatus(p.id, "pending")}
                            disabled={busyId === p.id}
                            title="Auf wartend zurücksetzen"
                            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-60"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Keine Nutzer gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {usersQ.isError && (
          <p className="text-xs text-destructive">
            Konnte Nutzer nicht laden — ist die Admin-Migration schon ausgeführt? (
            {usersQ.error instanceof Error ? usersQ.error.message : "Fehler"})
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${highlight ? "border-accent/50 bg-accent/5" : "border-border bg-card"}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-accent/20 text-accent",
    approved: "bg-primary/20 text-primary",
    rejected: "bg-destructive/20 text-destructive",
  };
  const label: Record<string, string> = {
    pending: "wartend",
    approved: "freigegeben",
    rejected: "abgelehnt",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${map[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {label[status] ?? status}
    </span>
  );
}
