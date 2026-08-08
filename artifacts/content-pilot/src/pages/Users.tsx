import { useState } from "react"
import {
  Shield, UserPlus, Trash2, Loader2, ShieldCheck,
  Pencil, Mail, Phone, StickyNote, KeyRound,
  CheckCircle2, XCircle, Clock,
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
import { useToast } from "@/hooks/use-toast"
import {
  useAdminUsers, useCreateAdminUser, useUpdateAdminUser,
  useDeleteAdminUser, useAuthStatus,
  type AdminUser, type UpdateAdminUserInput,
} from "@workspace/api-client-react"

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
  const [form, setForm] = useState<UpdateAdminUserInput & { password: string }>({
    fullName: user.fullName ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    notes: user.notes ?? "",
    isActive: user.isActive,
    password: "",
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
    if (form.password) payload.password = form.password

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
          <div className="space-y-1.5">
            <Label htmlFor="e-password">Nueva contraseña <span className="text-muted-foreground">(dejar vacío = no cambiar)</span></Label>
            <Input id="e-password" type="password" placeholder="Mín. 6 caracteres"
              value={form.password} onChange={set("password")} autoComplete="new-password" />
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
        Todos los usuarios activos tienen acceso de administrador completo a ContentPilot.
      </p>
    </div>
  )
}
