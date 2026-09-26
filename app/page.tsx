import Link from "next/link";

import { AdminApp } from "./_components/AdminApp";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Keyless Relay</h1>
        <p className="max-w-3xl text-zinc-600 dark:text-zinc-400">
          Your API keys stay in one relay. People and agents get ENS names instead, and each name says which APIs it may use and how
          much. Add a user in the team tree, watch their spend in the live view, remove them with one click. (Raw ENSv2 tools:{" "}
          <Link href="/playground" className="text-sky-600 hover:underline dark:text-sky-400">
            playground
          </Link>
          .)
        </p>
      </header>
      <AdminApp />
    </div>
  );
}
