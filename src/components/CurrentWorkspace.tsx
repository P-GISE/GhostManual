"use client";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { z } from "zod";
import { http } from "../lib/client";

export const workspacesSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    role: z.enum(["admin", "member"]).nullable(),
    current: z.boolean(),
  }),
);
type WorkspaceList = z.infer<typeof workspacesSchema> | null | undefined;
const WorkspaceContext = createContext<WorkspaceList>(undefined);

// Display metadata belongs to one route; server permissions are checked on every API request.
export function CurrentWorkspaceProvider({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<{ path: string; list: WorkspaceList }>({
    path: pathname,
    list: undefined,
  });
  if (snapshot.path !== pathname) setSnapshot({ path: pathname, list: undefined });
  useEffect(() => {
    if (!/^\/(sources|manuals|templates)(\/|$)/.test(pathname)) {
      setSnapshot({ path: pathname, list: null });
      return;
    }
    let active = true;
    const controller = new AbortController();
    void http
      .get("/api/workspaces", { signal: controller.signal, timeout: 15000 })
      .json()
      .then((body) => {
        const list = workspacesSchema.parse(body);
        if (active) setSnapshot({ path: pathname, list });
      })
      .catch(() => {
        if (active) setSnapshot({ path: pathname, list: null });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [pathname]);
  return (
    <WorkspaceContext.Provider value={snapshot.path === pathname ? snapshot.list : undefined}>
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspaceList() {
  return useContext(WorkspaceContext);
}
export function useCurrentWorkspace() {
  const list = useWorkspaceList();
  return list === undefined ? undefined : (list?.find((workspace) => workspace.current) ?? null);
}
