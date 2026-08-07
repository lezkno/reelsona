import * as React from "react"
import { Sidebar } from "./Sidebar"

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-y-auto">
        <div className="flex-1 w-full max-w-6xl mx-auto p-8 relative">
          {children}
        </div>
      </main>
    </div>
  )
}
