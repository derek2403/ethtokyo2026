"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { config } from "@/lib/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  // Pages refetch explicitly after each transaction; refetching every chain read
  // whenever the tab regains focus only burns the public RPC's rate limit.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
