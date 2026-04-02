"use client";

import { useAuth } from "@/components/auth/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import {
  Users, Activity, Layers, Trash2, UserPlus, Search,
  LogOut, ShieldCheck, RefreshCw, ChevronDown, Download,
} from "lucide-react";
import {
  getAllUsers, deleteUserRecord, updateUserRecord, addManualUser,
  getVectorizationStats, type UserRecord,
} from "@/lib/firebase/users";

type SubFilter = "all" | "active" | "trial" | "expired" | "none";

export default function AdminPage() {
  const { user, userRecord, loading, isSuperAdmin, logout } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0, totalVectorizations: 0 });
  const [search, setSearch] = useState("");
  const [subFilter, setSubFilter] = useState<SubFilter>("all");
  const [loadingData, setLoadingData] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"user" | "superadmin">("user");
  const [deleting, setDeleting] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    if (!loading && (!user || !isSuperAdmin)) {
      router.push("/dashboard");
    }
  }, [user, loading, isSuperAdmin, router]);

  const fetchData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [allUsers, vecStats] = await Promise.all([
        getAllUsers(),
        getVectorizationStats(),
      ]);
      setUsers(allUsers);
      setStats({
        totalUsers: allUsers.length,
        activeUsers: allUsers.filter((u) => u.subscriptionStatus === "active" || u.subscriptionStatus === "trial").length,
        totalVectorizations: vecStats.total,
      });
    } catch (err) {
      console.error("Failed to fetch admin data:", err);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) fetchData();
  }, [isSuperAdmin, fetchData]);

  const handleDelete = async (uid: string) => {
    if (!confirm("Delete this user permanently? This cannot be undone.")) return;
    setDeleting(uid);
    try {
      await deleteUserRecord(uid);
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeleting(null);
    }
  };

  const handleStatusChange = async (uid: string, status: UserRecord["subscriptionStatus"]) => {
    await updateUserRecord(uid, { subscriptionStatus: status });
    setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, subscriptionStatus: status } : u)));
  };

  const handleAddUser = async () => {
    if (!newEmail.trim()) return;
    await addManualUser(newEmail.trim(), newRole);
    setNewEmail("");
    setNewRole("user");
    setShowAddModal(false);
    fetchData();
  };

  // Filtering
  const filtered = users.filter((u) => {
    const matchesSearch =
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.displayName.toLowerCase().includes(search.toLowerCase());
    const matchesSub = subFilter === "all" || u.subscriptionStatus === subFilter;
    return matchesSearch && matchesSub;
  });

  if (loading || !isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin" />
      </div>
    );
  }

  const formatDate = (ts: any) => {
    if (!ts) return "Never";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const statusColors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    trial: "bg-dd-blue-400/10 text-dd-blue-400 border-dd-blue-400/20",
    expired: "bg-red-500/10 text-red-400 border-red-500/20",
    none: "bg-foreground-muted/10 text-foreground-muted border-foreground-muted/20",
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Nav ── */}
      <nav className="border-b border-border bg-background-raised/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-dd-gold-400 to-dd-gold-600 flex items-center justify-center shadow-md">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M4 4L12 20L20 4" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-base font-bold tracking-tight">
              Vector<span className="text-dd-gold-400">Ease</span>
            </h1>
            <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-dd-gold-400/10 text-dd-gold-400 border border-dd-gold-400/20 rounded-md">
              SuperAdmin
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-xs text-foreground-muted hover:text-dd-blue-400 transition-colors"
            >
              Editor
            </button>
            <button
              onClick={logout}
              className="p-2 rounded-lg hover:bg-dd-gold-400/10 text-foreground-muted hover:text-dd-gold-400 transition-all"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-[1440px] mx-auto px-6 py-8">
        {/* ── Stats ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
          {[
            { label: "Total Users", value: stats.totalUsers, icon: Users, accent: "gold" },
            { label: "Active / Trial", value: stats.activeUsers, icon: ShieldCheck, accent: "blue" },
            { label: "Total Vectorizations", value: stats.totalVectorizations, icon: Activity, accent: "gold" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-border bg-card p-6 flex items-center gap-5 transition-all hover:border-dd-gold-400/20 hover:bg-card-hover"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                s.accent === "gold" ? "bg-dd-gold-400/10 text-dd-gold-400" : "bg-dd-blue-400/10 text-dd-blue-400"
              }`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-foreground-muted font-medium uppercase tracking-wider">{s.label}</p>
                <p className="text-2xl font-bold mt-0.5">{loadingData ? "..." : s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
              <input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all placeholder:text-foreground-muted/40"
              />
            </div>
            <div className="relative">
              <select
                value={subFilter}
                onChange={(e) => setSubFilter(e.target.value as SubFilter)}
                className="appearance-none bg-background border border-border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-dd-gold-400/50 transition-all text-foreground cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="expired">Expired</option>
                <option value="none">None</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const csv = [
                  ["Name", "Email", "Phone", "Status", "Role", "Vectorizations", "Joined"].join(","),
                  ...users.map((u) => [
                    u.displayName,
                    u.email,
                    u.phone || "",
                    u.subscriptionStatus,
                    u.role,
                    u.totalVectorizations,
                    u.createdAt ? (u.createdAt.toDate ? u.createdAt.toDate().toISOString().split("T")[0] : "") : "",
                  ].map((v) => `"${v}"`).join(","))
                ].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `vectorease-users-${new Date().toISOString().split("T")[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              disabled={users.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border text-foreground-muted hover:border-dd-blue-400/30 hover:text-dd-blue-400 transition-all disabled:opacity-30"
              title="Export users as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              onClick={fetchData}
              className="p-2 rounded-lg border border-border hover:border-dd-blue-400/30 hover:bg-dd-blue-400/[0.05] text-foreground-muted hover:text-dd-blue-400 transition-all"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loadingData ? "animate-smooth-spin" : ""}`} />
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-md glow-gold hover:shadow-lg transition-all hover:scale-[1.02]"
            >
              <UserPlus className="w-4 h-4" />
              Add User
            </button>
          </div>
        </div>

        {/* ── Users Table ── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background-raised/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">User</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Role</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Vectors</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Joined</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Last Login</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingData ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-foreground-muted">
                      <div className="w-8 h-8 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin mx-auto mb-3" />
                      Loading users...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-foreground-muted">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.uid} className="border-b border-border-subtle hover:bg-card-hover transition-colors">
                      {/* User */}
                      <td className="px-5 py-4">
                        <div>
                          <p className="font-medium">{u.displayName}</p>
                          <p className="text-xs text-foreground-muted">{u.email}</p>
                        </div>
                      </td>
                      {/* Role */}
                      <td className="px-5 py-4">
                        {u.role === "superadmin" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-dd-gold-400">
                            <ShieldCheck className="w-3 h-3" /> Admin
                          </span>
                        ) : (
                          <span className="text-xs text-foreground-muted">User</span>
                        )}
                      </td>
                      {/* Status */}
                      <td className="px-5 py-4">
                        <div className="relative inline-block">
                          <select
                            value={u.subscriptionStatus}
                            onChange={(e) => handleStatusChange(u.uid, e.target.value as UserRecord["subscriptionStatus"])}
                            className={`appearance-none text-xs font-medium px-2.5 py-1 rounded-md border cursor-pointer bg-transparent focus:outline-none ${statusColors[u.subscriptionStatus]}`}
                          >
                            <option value="active">Active</option>
                            <option value="trial">Trial</option>
                            <option value="expired">Expired</option>
                            <option value="none">None</option>
                          </select>
                        </div>
                      </td>
                      {/* Vectors */}
                      <td className="px-5 py-4">
                        <span className="font-mono text-sm">{u.totalVectorizations}</span>
                      </td>
                      {/* Joined */}
                      <td className="px-5 py-4 text-xs text-foreground-muted">{formatDate(u.createdAt)}</td>
                      {/* Last Login */}
                      <td className="px-5 py-4 text-xs text-foreground-muted">{formatDate(u.lastLoginAt)}</td>
                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => handleDelete(u.uid)}
                          disabled={deleting === u.uid || u.role === "superadmin"}
                          className="p-1.5 rounded-lg text-foreground-muted hover:text-red-400 hover:bg-red-400/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                          title={u.role === "superadmin" ? "Cannot delete admin" : "Delete user"}
                        >
                          {deleting === u.uid ? (
                            <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-smooth-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border bg-background-raised/30 flex items-center justify-between">
            <p className="text-xs text-foreground-muted">
              Showing {filtered.length} of {users.length} users
            </p>
            <div className="flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-dd-gold-400" />
              <span className="text-xs text-foreground-muted">
                {stats.totalVectorizations} total vectorizations
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* ── Add User Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 glow-gold">
            <h3 className="text-lg font-bold mb-1">Add User</h3>
            <p className="text-xs text-foreground-muted mb-5">Manually add a user to the system</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all placeholder:text-foreground-muted/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setNewRole("user")}
                    className={`text-xs font-medium py-2.5 rounded-lg border transition-all ${
                      newRole === "user"
                        ? "border-dd-blue-400/40 bg-dd-blue-400/10 text-dd-blue-400"
                        : "border-border text-foreground-muted hover:bg-card-hover"
                    }`}
                  >
                    User
                  </button>
                  <button
                    onClick={() => setNewRole("superadmin")}
                    className={`text-xs font-medium py-2.5 rounded-lg border transition-all ${
                      newRole === "superadmin"
                        ? "border-dd-gold-400/40 bg-dd-gold-400/10 text-dd-gold-400"
                        : "border-border text-foreground-muted hover:bg-card-hover"
                    }`}
                  >
                    SuperAdmin
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-border text-foreground-muted hover:bg-card-hover transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddUser}
                disabled={!newEmail.trim()}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-md glow-gold hover:shadow-lg transition-all disabled:opacity-40"
              >
                Add User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
