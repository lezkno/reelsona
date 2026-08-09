import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Shield, UserPlus, Trash2, Loader2, ShieldCheck,
  Pencil, Mail, Phone, StickyNote, KeyRound,
  CheckCircle2, XCircle, Clock, Zap, BookOpen, Wrench,
  AlertCircle,
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
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  useAdminUsers, useCreateAdminUser, useUpdateAdminUser,
  useDeleteAdminUser, useAuthStatus,
  type AdminUser, type UpdateAdminUserInput,
} from "@workspace/api-client-react"

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

// ── Add user dialog ───────────────────────────────────────────────────────────

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
        <Button size="sm" className="gap-2">
          <UserPlus className="w-4 h-4" /> Nuevo usuario
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear usuario administrador</DialogTitle>
          <DialogDescription>
            Tendrá acceso completo a ContentPilot.
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

function DeleteUserButton({ user, selfUsername }: { user: AdminUser; selfUsername?: string }) {
  const del = useDeleteAdminUser()
  const { toast } = useToast()
  if (user.username === selfUsername) return null

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Eliminar">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>@{user.username}</strong> {user.fullName ? `(${user.fullName}) ` : ""}
            será eliminado permanentemente y no podrá iniciar sesión.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() =>
              del.mutate({ id: user.id }, {
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

// ── Provision dialog (create student access) ─────────────────────────────────

interface ProvisionResult {
  ok: boolean
  userId?: number
  created?: boolean
  emailSent?: boolean
  warning?: string
  error?: string
}

function ProvisionDialog({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    email: "", fullName: "", toolAccessDays: "30", source: "manual",
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const { toast } = useToast()

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleClose = (v: boolean) => {
    setOpen(v)
    if (!v) { setResult(null); setForm({ email: "", fullName: "", toolAccessDays: "30", source: "manual" }) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(`${BASE}/api/admin/provision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          fullName: form.fullName.trim() || undefined,
          toolAccessDays: Number(form.toolAccessDays) || 30,
          source: form.source.trim() || "manual",
        }),
      })
      const data: ProvisionResult = await res.json()
      if (!res.ok || !data.ok) {
        setResult({ ok: false, error: data.error ?? "Error al provisionar" })
        return
      }
      setResult(data)
      if (data.emailSent) {
        toast({ title: "Alumno registrado", description: `Email de activación enviado a ${form.email}` })
      } else {
        toast({ title: "Alumno registrado", description: data.warning ?? "Revisa el email manualmente.", variant: "default" })
      }
      onDone?.()
    } catch (err: any) {
      setResult({ ok: false, error: err?.message ?? "Error de red" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm" variant="default" className="gap-2">
          <Zap className="w-4 h-4" /> Dar de alta alumno
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Dar de alta alumno
          </DialogTitle>
          <DialogDescription>
            Crea el acceso del alumno y envía el link de activación por email.
          </DialogDescription>
        </DialogHeader>

        {result?.ok ? (
          <div className="py-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="font-medium">
                {result.created ? "Alumno creado correctamente" : "Acceso actualizado"}
              </span>
            </div>
            {result.emailSent ? (
              <p className="text-sm text-muted-foreground">
                Email de activación enviado a <strong>{form.email}</strong>.
              </p>
            ) : (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-amber-800 dark:text-amber-300 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{result.warning ?? "No se pudo enviar el email. Comprueba la configuración de Resend."}</span>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Cerrar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="p-email">Email del alumno *</Label>
              <Input id="p-email" type="email" placeholder="alumno@ejemplo.com"
                value={form.email} onChange={set("email")} required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Nombre completo</Label>
              <Input id="p-name" placeholder="María García"
                value={form.fullName} onChange={set("fullName")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-days">Días de acceso *</Label>
                <Input id="p-days" type="number" min={1} max={3650}
                  value={form.toolAccessDays} onChange={set("toolAccessDays")} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-source">Fuente / Notas</Label>
                <Input id="p-source" placeholder="manual, stripe…"
                  value={form.source} onChange={set("source")} />
              </div>
            </div>
            {result?.error && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <XCircle className="w-4 h-4 shrink-0" /> {result.error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button type="submit" disabled={loading || !form.email}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Procesando…</> : "Dar de alta"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Entitlements section ──────────────────────────────────────────────────────

interface EntitlementRow {
  id:                 number
  userId:             number
  courseAccess:       boolean
  toolAccessStatus:   string
  toolAccessEndsAt:   string | null
  source:             string | null
  createdAt:          string
  user: {
    username:  string
    email:     string | null
    fullName:  string | null
  }
}

const TOOL_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:   { label: "Activo",     cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  trialing: { label: "En prueba",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  expired:  { label: "Vencido",    cls: "bg-destructive/10 text-destructive" },
  disabled: { label: "Sin acceso", cls: "bg-muted text-muted-foreground" },
}

function EntitlementsSection() {
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery<EntitlementRow[]>({
    queryKey: ["admin", "entitlements"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/admin/entitlements`, { credentials: "include" })
      if (!res.ok) throw new Error("Error al cargar licencias")
      return res.json()
    },
    staleTime: 60_000,
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Licencias de alumnos</h2>
          <p className="text-xs text-muted-foreground">
            {data ? `${data.length} alumno${data.length !== 1 ? "s" : ""} registrado${data.length !== 1 ? "s" : ""}` : "Accesos otorgados a través de /admin/provision"}
          </p>
        </div>
        <ProvisionDialog onDone={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["admin", "entitlements"] }) }} />
      </div>

      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {isLoading && (
          <div className="p-6 space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}
        {error && (
          <div className="py-10 text-center text-destructive text-sm">Error al cargar licencias</div>
        )}
        {!isLoading && !error && data?.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">
            Todavía no hay alumnos. Usa «Dar de alta alumno» para crear el primer acceso.
          </div>
        )}
        {!isLoading && !error && data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-5 py-3 font-medium text-muted-foreground whitespace-nowrap">Alumno</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> Curso</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Wrench className="w-3.5 h-3.5" /> Herramienta</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Vence</span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => {
                  const badge = TOOL_STATUS_BADGE[row.toolAccessStatus] ?? TOOL_STATUS_BADGE.disabled
                  const endDate = row.toolAccessEndsAt
                    ? new Date(row.toolAccessEndsAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
                    : "—"
                  const isExpired = row.toolAccessStatus === "expired" ||
                    (row.toolAccessEndsAt ? new Date(row.toolAccessEndsAt) < new Date() : false)
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-foreground leading-tight">
                          {row.user.fullName ?? row.user.username}
                        </p>
                        {row.user.email && (
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">{row.user.email}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {row.courseAccess
                          ? <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> Sí</span>
                          : <span className="flex items-center gap-1 text-muted-foreground text-xs"><XCircle className="w-3.5 h-3.5" /> No</span>
                        }
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className={`px-4 py-3.5 text-xs whitespace-nowrap ${isExpired ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {endDate}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">{row.source ?? "—"}</td>
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

export default function Users() {
  const { data: userList, isLoading, error } = useAdminUsers()
  const { data: authData } = useAuthStatus()
  const selfUsername = authData?.user?.username

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Usuarios administradores</h1>
            <p className="text-sm text-muted-foreground">
              {userList ? `${userList.length} usuario${userList.length !== 1 ? "s" : ""} registrado${userList.length !== 1 ? "s" : ""}` : "Gestiona acceso a ContentPilot"}
            </p>
          </div>
        </div>
        <AddUserDialog />
      </div>

      {/* Table */}
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
                    className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
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
                        <EditUserDialog user={user} selfUsername={selfUsername} />
                        <ChangePasswordDialog user={user} />
                        <DeleteUserButton user={user} selfUsername={selfUsername} />
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
        Los usuarios de esta tabla tienen acceso de administrador completo.
        Los alumnos se gestionan en la sección siguiente.
      </p>

      {/* Entitlements section */}
      <EntitlementsSection />
    </div>
  )
}
