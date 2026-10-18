"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { SWRConfig } from "swr";
import { useAuth } from "../auth/AuthProvider";
import { setActiveBoardUser } from "../trends/active-board";
import { installNavigationHistory } from "../navigation";
import { setPrivateRequestUser } from "../auth/private-fetch";

interface QueryProviderProps {
  readonly children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const { session } = useAuth();
  const userId = session?.user.id ?? "anonymous";
  useLayoutEffect(installNavigationHistory, []);
  useLayoutEffect(() => {
    setPrivateRequestUser(session?.user.id ?? null);
    setActiveBoardUser(session?.user.id ?? null);
  }, [session?.user.id]);
  return <UserQueryScope key={userId}>{children}</UserQueryScope>;
}

function UserQueryScope({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  const [swrCache] = useState(() => new Map());
  useEffect(() => () => {
    void queryClient.cancelQueries();
    queryClient.clear();
    swrCache.clear();
    window.dispatchEvent(new Event("fashion:session-changed"));
  }, [queryClient, swrCache]);
  return (
    <QueryClientProvider client={queryClient}>
      <SWRConfig value={{ provider: () => swrCache }}>{children}</SWRConfig>
    </QueryClientProvider>
  );
}
