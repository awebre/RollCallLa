import { createContext, useContext, useEffect, useState } from "react";

type AdminContextValue = {
  isAdmin: boolean;
  /** true while the /api/admin/me fetch is in flight */
  loading: boolean;
  logout: () => Promise<void>;
};

const AdminContext = createContext<AdminContextValue>({
  isAdmin: false,
  loading: true,
  logout: async () => {},
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json() as Promise<{ authenticated: boolean }>)
      .then((d) => setIsAdmin(d.authenticated))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setIsAdmin(false);
  }

  return (
    <AdminContext.Provider value={{ isAdmin, loading, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
