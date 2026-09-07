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
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        () => qc.invalidateQueries({ queryKey: ["admin_users"] }),
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
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.display_name ?? "").toLowerCase().includes(q)
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
        <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <Shield className="h-4 w-4" /> Admin-Portal
        </p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Nutzerverwaltung</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Jede Registrierung wartet hier auf deine Freigabe. Ohne Freigabe kein Zugang zum Tool.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="Gesamt" value={users.length} />
        <StatCard
          icon={<Hourglass className="h-4 w-4 text-warning" />}
          label="Wartend"
          value={pending.length}
          highlight={pending.length > 0}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
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
        <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
          <Hourglass className="h-4 w-4 text-warning" /> Neue Registrierungen ({pending.length})
        </div>
        {pending.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
            Keine wartenden Registrierungen. Neue erscheinen hier automatisch.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-[18px] border border-border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{p.display_name ?? "Kein Name"}</div>
                  <div className="truncate text-[13px] text-muted-foreground">{p.email}</div>
                  <div className="text-[12px] tabular-nums text-muted-foreground">
                    registriert: {new Date(p.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStatus(p.id, "approved")}
                    disabled={busyId === p.id}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-[#0077ed] disabled:opacity-40 dark:hover:bg-[#3ea0ff]"
                  >
                    <UserCheck className="h-4 w-4" /> Freigeben
                  </button>
                  <button
                    onClick={() => setStatus(p.id, "rejected")}
                    disabled={busyId === p.id}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-destructive/15 px-4 text-[13px] font-semibold text-destructive hover:bg-destructive/25 disabled:opacity-40"
                  >
                    <UserX className="h-4 w-4" /> Ablehnen
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <Users className="h-4 w-4" /> Alle Nutzer
          </div>
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="E-Mail oder Name suchen…"
              className="h-9 rounded-[9px] border border-border bg-input pl-9 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60"
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-[18px] border border-border bg-card">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-border text-[13px] font-semibold text-muted-foreground">
                <th className="h-11 px-3 font-semibold">Nutzer</th>
                <th className="h-11 px-3 font-semibold">Status</th>
                <th className="h-11 px-3 font-semibold">Rolle</th>
                <th className="h-11 px-3 font-semibold">Registriert</th>
                <th className="h-11 px-3 text-right font-semibold">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-secondary/40">
                  <td className="px-3 py-3">
                    <div className="font-semibold">{p.display_name ?? "Kein Name"}</div>
                    <div className="text-[13px] text-muted-foreground">{p.email}</div>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-3">
                    {p.role === "admin" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[12px] font-semibold text-primary">
                        <Shield className="h-3 w-3" /> Admin
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">Nutzer</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[13px] tabular-nums text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {p.role !== "admin" && (
                      <div className="inline-flex gap-1">
                        {p.status !== "approved" && (
                          <button
                            onClick={() => setStatus(p.id, "approved")}
                            disabled={busyId === p.id}
                            title="Freigeben"
                            className="grid h-8 w-8 place-items-center rounded-full text-primary hover:bg-secondary disabled:opacity-40"
                          >
                            <UserCheck className="h-4 w-4" />
                          </button>
                        )}
                        {p.status !== "rejected" && (
                          <button
                            onClick={() => setStatus(p.id, "rejected")}
                            disabled={busyId === p.id}
                            title="Sperren/Ablehnen"
                            className="grid h-8 w-8 place-items-center rounded-full text-destructive hover:bg-secondary disabled:opacity-40"
                          >
                            <UserX className="h-4 w-4" />
                          </button>
                        )}
                        {p.status !== "pending" && (
                          <button
                            onClick={() => setStatus(p.id, "pending")}
                            disabled={busyId === p.id}
                            title="Auf wartend zurücksetzen"
                            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                    Keine Nutzer gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {usersQ.isError && (
          <p className="text-[13px] text-destructive">
            Konnte Nutzer nicht laden. Ist die Admin-Migration schon ausgeführt? (
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
      className={`rounded-[18px] border p-4 ${highlight ? "border-warning/40 bg-warning/5" : "border-border bg-card"}`}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-[28px] font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    approved: "bg-success/15 text-success",
    rejected: "bg-destructive/15 text-destructive",
  };
  const label: Record<string, string> = {
    pending: "Wartend",
    approved: "Freigegeben",
    rejected: "Abgelehnt",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${map[status] ?? "bg-secondary text-foreground"}`}
    >
      {label[status] ?? status}
    </span>
  );
}
