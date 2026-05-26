import { createContext, useContext, useEffect, useState } from "react";

type AdminContextValue = {
  isAdmin: boolean;
  /** true while the /api/admin/me fetch is in flight */
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AdminContext = createContext<AdminContextValue>({
  isAdmin: false,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    await fetch("/api/admin/me")
      .then((r) => r.json() as Promise<{ authenticated: boolean }>)
      .then((d) => setIsAdmin(d.authenticated))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setIsAdmin(false);
  }

  return (
    <AdminContext.Provider value={{ isAdmin, loading, refresh, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
