import { useState } from "react"
import {
  Shield, UserPlus, Trash2, Loader2, ShieldCheck,
  Pencil, Mail, Phone, StickyNote, KeyRound,
  CheckCircle2, XCircle, Clock, GraduationCap,
  RefreshCw, AlertCircle, Info, BookOpen, Wrench,
  CalendarDays, Download, Coins, PlusCircle, MinusCircle, Crown, Eye,
  PauseCircle, PlayCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  useAdminUsers, useCreateAdminUser, useUpdateAdminUser,
  useDeleteAdminUser, useAuthStatus,
  useAdminEntitlements, useProvisionStudent, useResendActivation,
  useUpdateEntitlementDays, useAdjustUserCredits, useAdminSetUserPlan,
  useAdminUserDetail, useToggleSuspendUser,
  type AdminUser, type UpdateAdminUserInput, type AdminEntitlement,
} from "@workspace/api-client-react"
import { cn } from "@/lib/utils"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "numeric",
  })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "Nunca"
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function initials(user: AdminUser) {
  const name = user.fullName ?? user.username
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}

function daysRemaining(isoEnd: string | null): number | null {
  if (!isoEnd) return null
  const ms = new Date(isoEnd).getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

// ── Admin user dialogs ────────────────────────────────────────────────────────

function AddUserDialog() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    username: "", password: "", fullName: "", email: "", phone: "", notes: "",
  })
  const [error, setError] = useState<string | null>(null)
  const create = useCreateAdminUser()
  const { toast } = useToast()

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    create.mutate(
      { ...form, role: "admin" },
      {
        onSuccess: () => {
          toast({ title: "Usuario creado", description: `@${form.username} puede iniciar sesión.` })
          setOpen(false)
          setForm({ username: "", password: "", fullName: "", email: "", phone: "", notes: "" })
        },
        onError: (err: any) => setError(err?.data?.error ?? err?.message ?? "Error al crear usuario"),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <UserPlus className="w-4 h-4" /> Nuevo administrador
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear usuario administrador</DialogTitle>
          <DialogDescription>
            Tendrá acceso completo a Reelsona.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-username">Usuario *</Label>
              <Input id="c-username" placeholder="usuario" value={form.username}
                onChange={set("username")} autoComplete="off" minLength={3} maxLength={64} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-password">Contraseña *</Label>
              <Input id="c-password" type="password" placeholder="Mín. 6 caracteres"
                value={form.password} onChange={set("password")} autoComplete="new-password"
                minLength={6} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-fullname">Nombre completo</Label>
            <Input id="c-fullname" placeholder="Nombre Apellido" value={form.fullName} onChange={set("fullName")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" placeholder="correo@ejemplo.com"
                value={form.email} onChange={set("email")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Teléfono</Label>
              <Input id="c-phone" type="tel" placeholder="+52 55 0000 0000"
                value={form.phone} onChange={set("phone")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-notes">Notas internas</Label>
            <Textarea id="c-notes" placeholder="Notas visibles solo para administradores…"
              value={form.notes} onChange={set("notes")} rows={2} className="resize-none" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending || !form.username || !form.password}>
              {create.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creando…</> : "Crear usuario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit user dialog ──────────────────────────────────────────────────────────

function EditUserDialog({ user, selfUsername }: { user: AdminUser; selfUsername?: string }) {
  const [open, setOpen] = useState(false)
  const isSelf = user.username === selfUsername
  const [form, setForm] = useState<UpdateAdminUserInput>({
    fullName: user.fullName ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    notes: user.notes ?? "",
    isActive: user.isActive,
  })
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateAdminUser()
  const { toast } = useToast()

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const payload: UpdateAdminUserInput = {
      fullName: form.fullName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      notes: form.notes || undefined,
    }
    if (!isSelf) payload.isActive = form.isActive

    update.mutate(
      { id: user.id, ...payload },
      {
        onSuccess: () => {
          toast({ title: "Usuario actualizado" })
          setOpen(false)
        },
        onError: (err: any) => setError(err?.data?.error ?? err?.message ?? "Error al actualizar"),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Editar">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar usuario @{user.username}</DialogTitle>
          <DialogDescription>
            {isSelf ? "No puedes cambiar tu propio rol ni desactivarte." : "Actualiza los datos del usuario."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="e-fullname">Nombre completo</Label>
            <Input id="e-fullname" placeholder="Nombre Apellido" value={form.fullName ?? ""}
              onChange={set("fullName")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="e-email">Email</Label>
              <Input id="e-email" type="email" placeholder="correo@ejemplo.com"
                value={form.email ?? ""} onChange={set("email")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-phone">Teléfono</Label>
              <Input id="e-phone" type="tel" placeholder="+52 55 0000 0000"
                value={form.phone ?? ""} onChange={set("phone")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-notes">Notas internas</Label>
            <Textarea id="e-notes" placeholder="Notas visibles solo para administradores…"
              value={form.notes ?? ""} onChange={set("notes")} rows={2} className="resize-none" />
          </div>
          {!isSelf && (
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Usuario activo</p>
                <p className="text-xs text-muted-foreground">Los usuarios inactivos no pueden iniciar sesión</p>
              </div>
              <Switch
                checked={form.isActive ?? true}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…</> : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Change password dialog ────────────────────────────────────────────────────

function ChangePasswordDialog({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateAdminUser()
  const { toast } = useToast()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError("Las contraseñas no coinciden")
      return
    }
    update.mutate(
      { id: user.id, password },
      {
        onSuccess: () => {
          toast({ title: "Contraseña actualizada", description: `La contraseña de @${user.username} fue cambiada.` })
          setOpen(false)
          setPassword("")
          setConfirm("")
        },
        onError: (err: any) => setError(err?.data?.error ?? err?.message ?? "Error al cambiar contraseña"),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPassword(""); setConfirm(""); setError(null) } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Cambiar contraseña">
          <KeyRound className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            Nueva contraseña para <strong>@{user.username}</strong>
            {user.fullName ? ` (${user.fullName})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">Nueva contraseña</Label>
            <Input
              id="cp-new"
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">Confirmar contraseña</Label>
            <Input
              id="cp-confirm"
              type="password"
              placeholder="Repite la contraseña"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={update.isPending || !password || !confirm}>
              {update.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando…</>
                : "Cambiar contraseña"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Delete button ─────────────────────────────────────────────────────────────

function DeleteUserButton({
  userId, username, fullName, selfUsername,
}: {
  userId: number; username: string; fullName?: string | null; selfUsername?: string
}) {
  const del = useDeleteAdminUser()
  const { toast } = useToast()
  if (selfUsername && username === selfUsername) return null

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Eliminar usuario">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>@{username}</strong>{fullName ? ` (${fullName})` : ""}{" "}
            será eliminado permanentemente y no podrá iniciar sesión.
            Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() =>
              del.mutate({ id: userId }, {
                onSuccess: () => toast({ title: "Usuario eliminado" }),
                onError: (err: any) => toast({
                  title: "Error", variant: "destructive",
                  description: err?.data?.error ?? "No se pudo eliminar",
                }),
              })
            }
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Suspend / reactivate user button ─────────────────────────────────────────

function SuspendUserButton({
  userId, username, fullName, isSuspended, selfUsername,
}: {
  userId: number; username: string; fullName?: string | null
  isSuspended: boolean; selfUsername?: string
}) {
  const [open, setOpen] = useState(false)
  const toggle = useToggleSuspendUser()
  const { toast } = useToast()

  if (selfUsername && username === selfUsername) return null

  const handleConfirm = () => {
    toggle.mutate(
      { userId },
      {
        onSuccess: (data) => {
          toast({
            title:       data.isSuspended ? "Cuenta suspendida" : "Cuenta reactivada",
            description: data.isSuspended
              ? `${fullName ?? username} ya no puede iniciar sesión.`
              : `${fullName ?? username} puede iniciar sesión nuevamente.`,
          })
          setOpen(false)
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err?.data?.error ?? "No se pudo actualizar la cuenta", variant: "destructive" })
          setOpen(false)
        },
      }
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="icon"
            className={cn(
              "h-7 w-7",
              isSuspended
                ? "text-amber-500 hover:text-emerald-600"
                : "text-muted-foreground hover:text-amber-500"
            )}
            title={isSuspended ? "Reactivar cuenta" : "Suspender cuenta"}
            onClick={() => setOpen(true)}
          >
            {isSuspended
              ? <PlayCircle className="w-3.5 h-3.5" />
              : <PauseCircle className="w-3.5 h-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {isSuspended ? "Reactivar cuenta" : "Suspender cuenta"}
        </TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSuspended ? "¿Reactivar cuenta?" : "¿Suspender cuenta?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSuspended
              ? `${fullName ?? username} podrá iniciar sesión nuevamente.`
              : `${fullName ?? username} no podrá iniciar sesión mientras la cuenta esté suspendida. Las sesiones activas se bloquean en menos de 30 segundos.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={isSuspended ? "" : "bg-amber-600 hover:bg-amber-700 text-white"}
            disabled={toggle.isPending}
          >
            {toggle.isPending
              ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Procesando…</>
              : isSuspended ? "Reactivar" : "Suspender"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Admin set-plan dialog ─────────────────────────────────────────────────────

const PLAN_OPTIONS = [
  { value: "basic",   label: "Basic",   sub: "400 créditos/mes" },
  { value: "pro",     label: "Pro",     sub: "1 500 créditos/mes" },
  { value: "founder", label: "Founder", sub: "1 500 créditos/mes · período anual" },
  { value: "none",    label: "Sin plan", sub: "Cancelar suscripción" },
] as const

function AdminSetPlanDialog({ userId, username }: { userId: number; username: string }) {
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<string>("")
  const setPlanMutation = useAdminSetUserPlan()
  const { toast } = useToast()

  const handleSubmit = () => {
    if (!plan) return
    setPlanMutation.mutate({ userId, planSlug: plan }, {
      onSuccess: (data) => {
        toast({
          title: "Plan actualizado",
          description: data.creditsGranted > 0
            ? `@${username} → ${plan} · ${data.creditsGranted} créditos recargados`
            : `@${username} → sin plan`,
        })
        setOpen(false)
        setPlan("")
      },
      onError: (err: any) => {
        toast({
          title: "Error",
          variant: "destructive",
          description: err?.data?.error ?? err?.message ?? "No se pudo cambiar el plan",
        })
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setPlan("") }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-primary" title="Asignar plan">
          <Crown className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Asignar plan</DialogTitle>
          <DialogDescription>
            El plan se activa de inmediato y los créditos mensuales se recargan como si el
            usuario hubiera comprado el plan. No se realiza ningún cargo.
            <br /><span className="font-medium">@{username}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {PLAN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPlan(opt.value)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors",
                plan === opt.value
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border hover:border-muted-foreground/50 text-muted-foreground hover:text-foreground",
              )}
            >
              <Crown className={cn("w-4 h-4 shrink-0", plan === opt.value ? "text-primary" : "")} />
              <div>
                <p className="text-sm font-medium leading-none">{opt.label}</p>
                <p className="text-xs mt-0.5 opacity-70">{opt.sub}</p>
              </div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); setPlan("") }}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!plan || setPlanMutation.isPending}
          >
            {setPlanMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Status badge helper ───────────────────────────────────────────────────────

const TOOL_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:   { label: "Activo",     cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  trialing: { label: "En prueba",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  expired:  { label: "Vencido",    cls: "bg-destructive/10 text-destructive" },
  disabled: { label: "Sin acceso", cls: "bg-muted text-muted-foreground" },
}

// ── Resend activation button ──────────────────────────────────────────────────

function ResendActivationButton({ entitlement }: { entitlement: AdminEntitlement }) {
  const resend = useResendActivation()
  const { toast } = useToast()

  const handleResend = () => {
    resend.mutate(
      { email: entitlement.username },
      {
        onSuccess: (data) => {
          if (data.emailSent) {
            toast({ title: "Email enviado", description: `Link de activación reenviado a ${entitlement.username}` })
          } else {
            toast({
              title: "Token renovado",
              description: data.warning ?? "No se pudo enviar el email",
              variant: "destructive",
            })
          }
        },
        onError: (err: any) =>
          toast({
            title: "Error",
            description: err?.data?.error ?? "No se pudo reenviar",
            variant: "destructive",
          }),
      }
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={handleResend}
          disabled={resend.isPending}
          title="Reenviar link de activación"
        >
          {resend.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">Reenviar link de activación</TooltipContent>
    </Tooltip>
  )
}

// ── Adjust credits button (admin) ─────────────────────────────────────────────

function AdjustCreditsButton({
  userId, displayName, currentCredits,
}: {
  userId: number; displayName: string; currentCredits?: number | null
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const adjust = useAdjustUserCredits()
  const { toast } = useToast()

  const handleSave = () => {
    const n = parseInt(amount, 10)
    if (!Number.isFinite(n) || n === 0) {
      toast({ title: "Error", description: "Ingresa un número distinto de 0", variant: "destructive" }); return
    }
    adjust.mutate(
      { userId, amount: n, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: "Créditos ajustados", description: `${n > 0 ? "+" : ""}${n} créditos para ${displayName}` })
          setOpen(false); setAmount(""); setReason("")
        },
        onError: (err: any) =>
          toast({ title: "Error", description: err?.data?.error ?? "No se pudo ajustar", variant: "destructive" }),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setAmount(""); setReason("") } }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            title="Ajustar créditos"
            onClick={() => setOpen(true)}
          >
            <Coins className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">Ajustar créditos</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ajustar créditos</DialogTitle>
          <DialogDescription>
            {displayName}
            {currentCredits != null && <> — saldo actual: <strong>{currentCredits}</strong> créditos</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cantidad (positivo = añadir, negativo = descontar)</Label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAmount(a => a.startsWith("-") ? a.slice(1) : "-" + a)}>
                <MinusCircle className="w-3.5 h-3.5" />
              </Button>
              <Input
                type="number"
                placeholder="Ej. 100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
                autoFocus
              />
              <Button variant="outline" size="sm" onClick={() => setAmount(a => a.startsWith("-") ? a.slice(1) : a)}>
                <PlusCircle className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Motivo (opcional)</Label>
            <Input placeholder="Ej. Compensación, bono, corrección" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={adjust.isPending}>
            {adjust.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit access days button ───────────────────────────────────────────────────

function EditAccessDaysButton({ entitlement }: { entitlement: AdminEntitlement }) {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState("")
  const update = useUpdateEntitlementDays()
  const { toast } = useToast()

  const currentDays = entitlement.toolAccessEndsAt
    ? Math.max(0, Math.ceil((new Date(entitlement.toolAccessEndsAt).getTime() - Date.now()) / 86_400_000))
    : null

  const handleSave = () => {
    const d = parseInt(days, 10)
    if (!Number.isFinite(d) || d < 1) { toast({ title: "Error", description: "Ingresa un número de días válido (mín. 1)", variant: "destructive" }); return }
    update.mutate(
      { userId: entitlement.userId, toolAccessDays: d },
      {
        onSuccess: () => {
          toast({ title: "Acceso actualizado", description: `${entitlement.fullName ?? entitlement.username} tiene ahora ${d} días de acceso desde hoy.` })
          setOpen(false)
          setDays("")
        },
        onError: (err: any) =>
          toast({ title: "Error", description: err?.data?.error ?? "No se pudo actualizar", variant: "destructive" }),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDays("") }}>
      <DialogTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
              <CalendarDays className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">Editar días de acceso</TooltipContent>
        </Tooltip>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar acceso</DialogTitle>
          <DialogDescription>
            {entitlement.fullName ?? entitlement.username}
            {currentDays !== null && (
              <span className="ml-1 text-muted-foreground">— {currentDays}d restantes actualmente</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="access-days-input">Nuevos días de acceso (desde hoy)</Label>
          <Input
            id="access-days-input"
            type="number"
            min={1}
            max={3650}
            placeholder="Ej. 30"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">El vencimiento se calcula desde hoy.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Provision student dialog ──────────────────────────────────────────────────

const PROVISION_PLAN_OPTIONS = [
  { value: "",        label: "Sin plan",  sub: "Solo acceso al entorno" },
  { value: "basic",   label: "Basic",     sub: "400 créditos · 1 avatar" },
  { value: "pro",     label: "Pro",       sub: "1.500 créditos · 3 avatares" },
  { value: "founder", label: "Founder",   sub: "1.500 créditos · acceso anual" },
] as const

function ProvisionStudentDialog() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    courseAccess: true,
    planSlug: "",
  })
  const [result, setResult] = useState<{
    created: boolean; emailSent: boolean; warning?: string; creditsGranted?: number; planSlug?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const provision = useProvisionStudent()
  const { toast } = useToast()

  const reset = () => {
    setForm({ email: "", fullName: "", courseAccess: true, planSlug: "" })
    setResult(null)
    setError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    provision.mutate(
      {
        email:          form.email.trim().toLowerCase(),
        fullName:       form.fullName.trim(),
        toolAccessDays: 365,
        courseAccess:   form.courseAccess,
        planSlug:       form.planSlug || undefined,
      },
      {
        onSuccess: (data) => {
          setResult({
            created:        data.created,
            emailSent:      data.emailSent,
            warning:        data.warning,
            creditsGranted: data.creditsGranted,
            planSlug:       form.planSlug || undefined,
          })
          if (!data.warning) {
            toast({
              title:       data.created ? "Usuario dado de alta" : "Acceso actualizado",
              description: data.emailSent
                ? `Email de activación enviado a ${form.email}`
                : "No se pudo enviar el email de activación",
            })
          }
        },
        onError: (err: any) =>
          setError(err?.data?.error ?? err?.message ?? "Error al dar de alta"),
      }
    )
  }

  const handleClose = (v: boolean) => {
    if (!v) reset()
    setOpen(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <GraduationCap className="w-4 h-4" /> Dar acceso a usuario
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dar acceso a usuario</DialogTitle>
          <DialogDescription>
            Crea o actualiza el acceso de un usuario. Se enviará un email de activación con un enlace para elegir contraseña.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="py-2 space-y-4">
            <div className={cn(
              "flex items-start gap-3 rounded-lg border px-4 py-3",
              result.warning ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
            )}>
              {result.warning
                ? <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                : <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />}
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {result.created ? "Usuario creado" : "Acceso actualizado"}
                </p>
                {result.emailSent
                  ? <p className="text-sm text-muted-foreground">Email de activación enviado a <strong>{form.email}</strong>.</p>
                  : <p className="text-sm text-amber-700 dark:text-amber-400">No se pudo enviar el email de activación.</p>}
                {result.planSlug && (
                  <p className="text-sm text-muted-foreground">
                    Plan <strong className="capitalize">{result.planSlug}</strong> asignado
                    {result.creditsGranted ? ` · ${result.creditsGranted} créditos recargados` : ""}.
                  </p>
                )}
                {result.warning && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{result.warning}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { reset() }}>Dar de alta otro usuario</Button>
              <Button onClick={() => { reset(); setOpen(false) }}>Cerrar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="ps-fullname">Nombre completo *</Label>
              <Input
                id="ps-fullname"
                placeholder="María García"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-email">Email *</Label>
              <Input
                id="ps-email"
                type="email"
                placeholder="usuario@ejemplo.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
              <p className="text-xs text-muted-foreground">
                El email será el nombre de usuario para iniciar sesión.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-plan">Plan (opcional)</Label>
              <Select
                value={form.planSlug}
                onValueChange={(v) => setForm((f) => ({ ...f, planSlug: v }))}
              >
                <SelectTrigger id="ps-plan">
                  <SelectValue placeholder="Sin plan" />
                </SelectTrigger>
                <SelectContent>
                  {PROVISION_PLAN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="font-medium">{o.label}</span>
                      <span className="text-muted-foreground ml-1.5 text-xs">{o.sub}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Acceso al curso</p>
                <p className="text-xs text-muted-foreground">Incluye acceso permanente al material del curso</p>
              </div>
              <Switch
                checked={form.courseAccess}
                onCheckedChange={(v) => setForm((f) => ({ ...f, courseAccess: v }))}
              />
            </div>
            {error && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={provision.isPending || !form.email || !form.fullName}
              >
                {provision.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Procesando…</>
                  : "Dar acceso"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Entitlements section ──────────────────────────────────────────────────────

function EntitlementsSection() {
  const { data, isLoading, error } = useAdminEntitlements()
  const entitlements = data?.entitlements ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Acceso de usuarios</h2>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? "Cargando…"
                : `${entitlements.length} usuario${entitlements.length !== 1 ? "s" : ""} con entitlement`}
            </p>
          </div>
        </div>
        {!isLoading && entitlements.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { window.location.href = `${BASE}/api/admin/entitlements/export.csv` }}
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Descargar lista de usuarios como archivo CSV</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {isLoading && (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}
        {error && (
          <div className="py-10 text-center text-destructive text-sm">Error al cargar licencias</div>
        )}
        {!isLoading && !error && entitlements.length === 0 && (
          <div className="py-12 text-center space-y-2">
            <GraduationCap className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Aún no hay usuarios dados de alta.</p>
            <p className="text-xs text-muted-foreground">Usa el botón "Dar acceso a usuario" para empezar.</p>
          </div>
        )}
        {!isLoading && !error && entitlements.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground whitespace-nowrap">Usuario</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> Curso</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Wrench className="w-3.5 h-3.5" /> Herramienta</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Vencimiento</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Días</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center justify-end gap-1"><Coins className="w-3.5 h-3.5" /> Créditos</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Fuente</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Alta</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Últ. enlace</span>
                  </th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {entitlements.map((ent) => {
                  const days = daysRemaining(ent.toolAccessEndsAt)
                  const badge = TOOL_STATUS_BADGE[ent.toolAccessStatus] ?? TOOL_STATUS_BADGE.disabled
                  return (
                    <tr
                      key={ent.userId}
                      className={cn(
                        "border-b border-border last:border-0 hover:bg-muted/20 transition-colors",
                        ent.isSuspended && "opacity-60"
                      )}
                    >
                      {/* Usuario */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
                            ent.isActive
                              ? "bg-emerald-500/10 text-emerald-700"
                              : "bg-muted text-muted-foreground"
                          )}>
                            {(ent.fullName ?? ent.username).split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-foreground leading-tight">
                              {ent.fullName ?? <span className="text-muted-foreground">—</span>}
                            </p>
                            {!ent.isActive && (
                              <span className="text-xs text-amber-600 flex items-center gap-0.5">
                                <Info className="w-3 h-3" /> Pendiente activación
                              </span>
                            )}
                            {ent.isSuspended && (
                              <span className="text-xs text-amber-500 flex items-center gap-0.5">
                                <PauseCircle className="w-3 h-3" /> Suspendida
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Email */}
                      <td className="px-4 py-3.5">
                        <a href={`mailto:${ent.username}`} className="text-primary hover:underline text-xs">
                          {ent.username}
                        </a>
                      </td>
                      {/* Curso */}
                      <td className="px-4 py-3.5">
                        {ent.courseAccess
                          ? <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> Sí</span>
                          : <span className="flex items-center gap-1 text-muted-foreground text-xs"><XCircle className="w-3.5 h-3.5" /> No</span>}
                      </td>
                      {/* Herramienta */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      {/* Vencimiento */}
                      <td className={cn(
                        "px-4 py-3.5 text-xs whitespace-nowrap",
                        ent.toolAccessStatus === "expired" ? "text-destructive font-medium" : "text-muted-foreground"
                      )}>
                        {fmtDate(ent.toolAccessEndsAt)}
                      </td>
                      {/* Días restantes */}
                      <td className="px-4 py-3.5 text-xs">
                        {days === null ? (
                          <span className="text-muted-foreground/40">—</span>
                        ) : days <= 0 ? (
                          <span className="text-destructive font-medium">Vencido</span>
                        ) : (
                          <span className={cn(
                            "font-medium",
                            days <= 7 ? "text-amber-600" : "text-foreground"
                          )}>
                            {days}d
                          </span>
                        )}
                      </td>
                      {/* Fuente */}
                      <td className="px-4 py-3.5 text-xs text-muted-foreground capitalize">
                        {ent.source ?? "—"}
                      </td>
                      {/* Alta */}
                      <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(ent.createdAt)}
                      </td>
                      {/* Último enlace enviado (#101) */}
                      <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        {!ent.isActive && ent.activationTokenExpiresAt
                          ? (() => {
                              const sentMs = new Date(ent.activationTokenExpiresAt).getTime() - 7 * 86_400_000;
                              const expired = new Date(ent.activationTokenExpiresAt) < new Date();
                              return (
                                <span className={expired ? "text-destructive" : ""}>
                                  {new Date(sentMs).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                                  {expired && <span className="ml-1">(vencido)</span>}
                                </span>
                              );
                            })()
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Créditos disponibles */}
                      <td className="px-4 py-3.5 text-right">
                        {ent.availableCredits == null ? (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        ) : (
                          <span className={cn(
                            "text-base font-bold",
                            ent.availableCredits === 0 ? "text-destructive" :
                            ent.availableCredits <= 50  ? "text-amber-500" : "text-emerald-600"
                          )}>
                            {ent.availableCredits}
                          </span>
                        )}
                      </td>
                      {/* Acciones */}
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-0.5">
                          <EditAccessDaysButton entitlement={ent} />
                          {!ent.isActive && <ResendActivationButton entitlement={ent} />}
                          <AdjustCreditsButton
                            userId={ent.userId}
                            displayName={ent.fullName ?? ent.username}
                            currentCredits={ent.availableCredits}
                          />
                          <AdminSetPlanDialog userId={ent.userId} username={ent.username} />
                          <SuspendUserButton
                            userId={ent.userId}
                            username={ent.username}
                            fullName={ent.fullName}
                            isSuspended={ent.isSuspended}
                          />
                          <DeleteUserButton
                            userId={ent.userId}
                            username={ent.username}
                            fullName={ent.fullName}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Admin user detail modal ───────────────────────────────────────────────────

function AdminUserDetailModal({ userId, onClose }: { userId: number | null; onClose: () => void }) {
  const { data, isLoading, error } = useAdminUserDetail(userId)

  return (
    <Dialog open={!!userId} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="py-8 text-center text-destructive text-sm">Error al cargar el perfil</div>
        )}
        {data && (() => {
          const { account, subscription, credits, entitlement, instagram, production } = data
          const PLAN_COLOR: Record<string, string> = {
            basic: "text-blue-500", pro: "text-violet-500", founder: "text-amber-500",
          }
          return (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {(account.fullName ?? account.username).charAt(0).toUpperCase()}
                  </div>
                  <span>@{account.username}</span>
                  {account.role === "admin" && <Badge variant="secondary" className="text-xs">Admin</Badge>}
                  {!account.isActive && <Badge variant="destructive" className="text-xs">Inactivo</Badge>}
                  {account.activationPending && <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/40">Activación pendiente</Badge>}
                </DialogTitle>
                <DialogDescription>
                  {account.fullName && <>{account.fullName} · </>}{account.email ?? account.username}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 py-1">
                {/* CUENTA */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Cuenta</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                    <Row label="Creado"       value={fmtDate(account.createdAt)} />
                    <Row label="Último acceso" value={account.lastLoginAt ? fmtDate(account.lastLoginAt) : "Nunca"} />
                    {account.phone && <Row label="Teléfono" value={account.phone} />}
                    {account.notes && <div className="col-span-2"><span className="text-muted-foreground">Notas: </span><span className="text-xs">{account.notes}</span></div>}
                  </div>
                </div>

                {/* PLAN */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Plan</p>
                  {subscription ? (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      <Row label="Plan"   value={<span className={cn("font-semibold capitalize", PLAN_COLOR[subscription.planSlug])}>{subscription.planSlug}</span>} />
                      <Row label="Estado" value={subscription.status} />
                      <Row label="Inicio" value={fmtDate(subscription.currentPeriodStart)} />
                      <Row label="Fin"    value={fmtDate(subscription.currentPeriodEnd)} />
                      {subscription.cancelAtPeriodEnd && (
                        <div className="col-span-2"><span className="text-destructive text-xs">⚠ Cancela al fin del período</span></div>
                      )}
                      {subscription.pendingPlanSlug && (
                        <Row label="Downgrade pendiente" value={<span className="capitalize">{subscription.pendingPlanSlug}</span>} />
                      )}
                      {subscription.planSlug === "founder" && (
                        <Row label="Meses Founder" value={`${subscription.founderMonthsGranted}/12`} />
                      )}
                      <Row label="Stripe" value={subscription.hasStripeCustomer ? "Con cliente" : "Sin cliente"} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sin suscripción</p>
                  )}
                </div>

                {/* CRÉDITOS */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Créditos</p>
                  {credits ? (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      <Row label="Disponibles"      value={<span className="font-bold">{credits.availableCredits}</span>} />
                      <Row label="De suscripción"   value={credits.subscriptionCredits} />
                      <Row label="Comprados"         value={credits.purchasedCredits} />
                      <Row label="Reservados"        value={credits.reservedCredits} />
                      <Row label="Consumidos total"  value={credits.totalConsumed} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sin wallet</p>
                  )}
                </div>

                {/* PRODUCCIÓN */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Producción</p>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                    <Row label="Avatares"    value={production.avatarCount} />
                    <Row label="Looks"       value={production.lookCount} />
                    <Row label="Videos"      value={production.videoCount} />
                    <Row label="Publicados"  value={<span className="text-emerald-500">{production.publishedVideoCount}</span>} />
                    <Row label="Fallidos"    value={<span className={production.failedVideoCount > 0 ? "text-destructive" : ""}>{production.failedVideoCount}</span>} />
                    <Row label="En proceso"  value={production.inProgressCount} />
                  </div>
                </div>

                {/* HERRAMIENTA */}
                {entitlement && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Herramienta</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      <Row label="Estado" value={
                        <span className={
                          entitlement.toolAccessStatus === "active"   ? "text-emerald-500" :
                          entitlement.toolAccessStatus === "trialing" ? "text-blue-500" : "text-destructive"
                        }>
                          {TOOL_STATUS_BADGE[entitlement.toolAccessStatus]?.label ?? entitlement.toolAccessStatus}
                        </span>
                      } />
                      <Row label="Vence"  value={fmtDate(entitlement.toolAccessEndsAt)} />
                      <Row label="Fuente" value={entitlement.source ?? "—"} />
                      <Row label="Curso"  value={entitlement.courseAccess ? "Sí" : "No"} />
                    </div>
                  </div>
                )}

                {/* INSTAGRAM */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Instagram</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                    <Row label="Conectado" value={
                      <span className={instagram.connected ? "text-emerald-500" : "text-muted-foreground"}>
                        {instagram.connected ? "Sí" : "No"}
                      </span>
                    } />
                    {instagram.connected && <>
                      <Row label="Username"          value={`@${instagram.username}`} />
                      <Row label="Necesita reconexión" value={
                        <span className={instagram.needsReconnection ? "text-destructive" : "text-emerald-500"}>
                          {instagram.needsReconnection ? "Sí" : "No"}
                        </span>
                      } />
                    </>}
                  </div>
                </div>
              </div>
            </>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}

// Compact label-value row helper used inside AdminUserDetailModal
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right truncate">{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Users() {
  const { data: userList, isLoading, error } = useAdminUsers()
  const { data: authData } = useAuthStatus()
  const selfUsername = authData?.user?.username
  const [detailUserId, setDetailUserId] = useState<number | null>(null)

  return (
    <div className="space-y-10">
      <AdminUserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} />

      {/* ── Student access section ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-end">
          <ProvisionStudentDialog />
        </div>
        <EntitlementsSection />
      </div>

      {/* ── Divider ────────────────────────────────────────────────────────── */}
      <div className="border-t border-border" />

      {/* ── Admin users section ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Usuarios administradores</h2>
              <p className="text-sm text-muted-foreground">
                {userList
                  ? `${userList.length} usuario${userList.length !== 1 ? "s" : ""} registrado${userList.length !== 1 ? "s" : ""}`
                  : "Gestiona acceso a Reelsona"}
              </p>
            </div>
          </div>
          <AddUserDialog />
        </div>

        <div className="rounded-xl border border-border overflow-hidden bg-card">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /><span>Cargando usuarios…</span>
            </div>
          )}
          {error && (
            <div className="py-12 text-center text-destructive text-sm">Error al cargar usuarios</div>
          )}
          {!isLoading && !error && userList?.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">No hay usuarios registrados</div>
          )}
          {!isLoading && !error && userList && userList.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground whitespace-nowrap">Usuario</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Nombre</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</span>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Teléfono</span>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Rol</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Estado</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Último acceso</span>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Creado</th>
                    <th className="px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      <span className="flex items-center gap-1"><StickyNote className="w-3.5 h-3.5" /> Notas</span>
                    </th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {userList.map((user) => (
                    <tr key={user.id}
                      className={cn(
                        "border-b border-border last:border-0 hover:bg-muted/20 transition-colors",
                        user.isSuspended && "opacity-60"
                      )}>
                      {/* Usuario */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary text-xs font-bold">
                            {initials(user)}
                          </div>
                          <div>
                            <p className="font-medium text-foreground leading-tight">
                              @{user.username}
                              {user.username === selfUsername && (
                                <span className="ml-1.5 text-[10px] font-normal text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">tú</span>
                              )}
                            </p>
                            {user.isSuspended && (
                              <span className="text-xs text-amber-500 flex items-center gap-0.5">
                                <PauseCircle className="w-3 h-3" /> Suspendida
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Nombre */}
                      <td className="px-4 py-3.5 text-foreground/80 whitespace-nowrap">
                        {user.fullName ?? <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Email */}
                      <td className="px-4 py-3.5">
                        {user.email
                          ? <a href={`mailto:${user.email}`} className="text-primary hover:underline truncate max-w-[180px] block">{user.email}</a>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Teléfono */}
                      <td className="px-4 py-3.5 text-foreground/80 whitespace-nowrap">
                        {user.phone ?? <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Rol */}
                      <td className="px-4 py-3.5">
                        <Badge variant="secondary" className="capitalize text-xs gap-1">
                          <ShieldCheck className="w-3 h-3" />{user.role}
                        </Badge>
                      </td>
                      {/* Estado */}
                      <td className="px-4 py-3.5">
                        {user.isActive
                          ? <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Activo
                            </span>
                          : <span className="flex items-center gap-1 text-destructive text-xs font-medium">
                              <XCircle className="w-3.5 h-3.5" /> Inactivo
                            </span>}
                      </td>
                      {/* Último acceso */}
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap text-xs">
                        {fmtDateTime(user.lastLoginAt)}
                      </td>
                      {/* Creado */}
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap text-xs">
                        {fmtDate(user.createdAt)}
                      </td>
                      {/* Notas */}
                      <td className="px-3 py-3.5 text-center">
                        {user.notes
                          ? <Tooltip>
                              <TooltipTrigger asChild>
                                <StickyNote className="w-3.5 h-3.5 text-amber-500 cursor-help mx-auto" />
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs text-xs whitespace-pre-wrap">
                                {user.notes}
                              </TooltipContent>
                            </Tooltip>
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      {/* Acciones */}
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="Ver detalle"
                            onClick={() => setDetailUserId(user.id)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <AdjustCreditsButton userId={user.id} displayName={user.fullName ?? user.username} />
                          <AdminSetPlanDialog userId={user.id} username={user.username} />
                          <EditUserDialog user={user} selfUsername={selfUsername} />
                          <ChangePasswordDialog user={user} />
                          <SuspendUserButton
                            userId={user.id}
                            username={user.username}
                            fullName={user.fullName}
                            isSuspended={user.isSuspended}
                            selfUsername={selfUsername}
                          />
                          <DeleteUserButton userId={user.id} username={user.username} fullName={user.fullName} selfUsername={selfUsername} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Todos los usuarios activos tienen acceso de administrador completo a Reelsona.
        </p>
      </div>
    </div>
  )
}
