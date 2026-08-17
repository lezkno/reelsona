import { Route, Switch, Router as WouterRouter, useLocation } from "wouter"
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query"
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
import Profile from "@/pages/Profile"
import Course from "@/pages/Course"
import Login from "@/pages/Login"
import Register from "@/pages/Register"
import VerifyEmail from "@/pages/VerifyEmail"
import Activate from "@/pages/Activate"
import AccessExpired from "@/pages/AccessExpired"
import PrivacyPolicy from "@/pages/PrivacyPolicy"
import TermsAndConditions from "@/pages/TermsAndConditions"
import CheckoutSuccess from "@/pages/CheckoutSuccess"
import CheckoutCancel from "@/pages/CheckoutCancel"
import Landing from "@/pages/Landing"
import Billing from "@/pages/Billing"
import { useAuthStatus } from "@workspace/api-client-react"
import { useEntitlement } from "@/hooks/useEntitlement"
import ResendActivation from "@/pages/ResendActivation"
import ResetPassword from "@/pages/ResetPassword"

const BASE_LOGIN = `${import.meta.env.BASE_URL}login`.replace(/\/\//g, "/")

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: any) => {
      // Session expired or unauthenticated — send user to login.
      // Only redirect if we're not already on a public page to avoid loops.
      if (error?.status === 401) {
        const publicPaths = ["/login", "/register", "/activate", "/verify-email", "/reset-password", "/resend-activation", "/privacy", "/terms", "/checkout"]
        const isPublic = publicPaths.some((p) => window.location.pathname.includes(p))
        if (!isPublic) {
          queryClient.clear()
          window.location.href = BASE_LOGIN
        }
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * Renders the given component only if the user has active tool access.
 * Falls back to AccessExpired otherwise.
 * React Query deduplicates the entitlement query — no extra network request.
 */
function ToolRoute({ component: Component }: { component: React.ComponentType }) {
  const { data } = useEntitlement()
  if (data && !data.isAdmin && !data.toolAccessActive) {
    return <AccessExpired />
  }
  return <Component />
}


function Router() {
  return (
    <Layout>
      <Switch>
        {/* Always accessible after login */}
        <Route path="/" component={Dashboard} />
        <Route path="/settings" component={Settings} />
        <Route path="/profile" component={Profile} />
        <Route path="/course" component={Course} />
        <Route path="/access-expired" component={AccessExpired} />
        {/* Admin-only */}
        <Route path="/users" component={() => <AdminOnly><UsersPage /></AdminOnly>} />

        {/* Tool routes — blocked for expired access */}
        <Route path="/connect">
          {() => <ToolRoute component={Connect} />}
        </Route>
        <Route path="/audit">
          {() => <ToolRoute component={Audit} />}
        </Route>

        {/* Billing — accessible with tool access */}
        <Route path="/billing">
          {() => <Billing />}
        </Route>

        {/* HeyGen routes — tool access required */}
        <Route path="/content">
          {() => <ToolRoute component={ContentPlan} />}
        </Route>
        <Route path="/avatars">
          {() => <ToolRoute component={Avatars} />}
        </Route>
        <Route path="/videos">
          {() => <ToolRoute component={Videos} />}
        </Route>
        <Route path="/automation">
          {() => <ToolRoute component={Automation} />}
        </Route>
        <Route path="/captions">
          {() => <ToolRoute component={CaptionStudio} />}
        </Route>

        <Route component={NotFound} />
      </Switch>
    </Layout>
  )
}

/** Checks session status and renders Login or the app accordingly. */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, refetch } = useAuthStatus()
  const [, navigate] = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data?.authenticated) {
    return <Login onSuccess={() => { refetch(); navigate("/") }} />
  }

  return <>{children}</>
}

/** Renders children only for admin users; redirects others to the dashboard. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { data } = useAuthStatus()
  if (data?.user?.role !== "admin") {
    // Non-admin: redirect silently to dashboard
    return <Dashboard />
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
            <Route path="/register" component={Register} />
            <Route path="/verify-email" component={VerifyEmail} />
            <Route path="/landing" component={Landing} />
            <Route path="/activate" component={Activate} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/resend-activation" component={ResendActivation} />
            <Route path="/checkout/success" component={CheckoutSuccess} />
            <Route path="/checkout/cancel" component={CheckoutCancel} />
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
