import { Route, Switch, Router as WouterRouter } from "wouter"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Loader2 } from "lucide-react"

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
import UsersPage from "@/pages/Users"
import Login from "@/pages/Login"
import PrivacyPolicy from "@/pages/PrivacyPolicy"
import TermsAndConditions from "@/pages/TermsAndConditions"
import { useAuthStatus } from "@workspace/api-client-react"

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
        <Route path="/users" component={UsersPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  )
}

/** Checks session status and renders Login or the app accordingly. */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, refetch } = useAuthStatus()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data?.authenticated) {
    return <Login onSuccess={() => refetch()} />
  }

  return <>{children}</>
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Switch>
            <Route path="/privacy" component={PrivacyPolicy} />
            <Route path="/terms" component={TermsAndConditions} />
            <Route>
              <AuthGuard>
                <Router />
              </AuthGuard>
            </Route>
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App;
