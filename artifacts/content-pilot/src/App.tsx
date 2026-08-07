import { Route, Switch, Router as WouterRouter } from "wouter"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"

import { Layout } from "@/components/layout/Layout"
import NotFound from "@/pages/not-found"
import Dashboard from "@/pages/Dashboard"
import Connect from "@/pages/Connect"
import Audit from "@/pages/Audit"
import ContentPlan from "@/pages/ContentPlan"
import Avatars from "@/pages/Avatars"
import Videos from "@/pages/Videos"
import Settings from "@/pages/Settings"
import Automation from "@/pages/Automation"
import CaptionStudio from "@/pages/CaptionStudio"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
})

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/connect" component={Connect} />
        <Route path="/audit" component={Audit} />
        <Route path="/content" component={ContentPlan} />
        <Route path="/avatars" component={Avatars} />
        <Route path="/videos" component={Videos} />
        <Route path="/settings" component={Settings} />
        <Route path="/automation" component={Automation} />
        <Route path="/captions" component={CaptionStudio} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App;
