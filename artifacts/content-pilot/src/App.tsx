import { Route, Switch, Router as WouterRouter, useLocation } from "wouter"
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Loader2, Lock } from "lucide-react"

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
import { useAuthStatus, useBilling } from "@workspace/api-client-react"
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
      // Never retry client errors (4xx) — they won't resolve on their own
      // and the default 3 retries with exponential back-off add ~7 s of
      // artificial delay on every page that touches a gated endpoint.
      retry: (failureCount, error: any) => {
        if (error?.status >= 400 && error?.status < 500) return false
        return failureCount < 2
      },
    },
  },
})

/**
 * Plan-required screen — shown instead of the page when the user has no active plan.
 * Accessible pages (Dashboard, Billing, etc.) are NOT wrapped in ToolRoute.
 */
function NoPlanScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center gap-6 max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <Lock className="w-8 h-8 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-xl font-bold font-display mb-2">Tu plan no está activo</h2>
        <p className="text-sm text-muted-foreground">
          Activa un plan de Reelsona para acceder a esta función. Tus proyectos y recursos siguen guardados.
        </p>
      </div>
      <a
        href="/billing"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        Ver planes →
      </a>
    </div>
  )
}

/**
 * Renders the given component only if the user has an active plan subscription.
 * Falls back to NoPlanScreen for users without a plan.
 * While billing data is loading, renders the component (React Query deduplicates).
 * Admins always pass through regardless of subscription.
 */
function ToolRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: auth }    = useAuthStatus()
  const { data: billing } = useBilling()

  // Admins always pass through
  if (auth?.user?.role === "admin") return <Component />

  // While billing data is loading, show the component — billing resolves quickly
  // and any in-progress interactive state is already blocked by AccessBanner
  if (!billing) return <Component />

  const sub = billing.subscription
  const hasActiveSub = sub && ["active", "trialing"].includes(sub.status ?? "")
  if (!hasActiveSub) return <NoPlanScreen />

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

        {/* Always accessible (no plan required) */}
        <Route path="/connect">
          {() => <Connect />}
        </Route>
        <Route path="/videos">
          {() => <Videos />}
        </Route>
        <Route path="/billing">
          {() => <Billing />}
        </Route>

        {/* Plan-required routes — show NoPlanScreen without active subscription */}
        <Route path="/audit">
          {() => <ToolRoute component={Audit} />}
        </Route>
        <Route path="/content">
          {() => <ToolRoute component={ContentPlan} />}
        </Route>
        <Route path="/avatars">
          {() => <ToolRoute component={Avatars} />}
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
