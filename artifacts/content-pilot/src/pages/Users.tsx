import { useState } from "react"
import { Shield, UserPlus, Trash2, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  useAdminUsers,
  useCreateAdminUser,
  useDeleteAdminUser,
  useAuthStatus,
  type AdminUser,
} from "@workspace/api-client-react"

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function AddUserDialog() {
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const create = useCreateAdminUser()
  const { toast } = useToast()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    create.mutate(
      { username, password, role: "admin" },
      {
        onSuccess: () => {
          toast({ title: "Usuario creado", description: `@${username} puede iniciar sesión ahora.` })
          setOpen(false)
          setUsername("")
          setPassword("")
        },
        onError: (err: any) => {
          setError(err?.data?.error ?? err?.message ?? "Error al crear usuario")
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <UserPlus className="w-4 h-4" />
          Nuevo usuario
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear usuario administrador</DialogTitle>
          <DialogDescription>
            El nuevo usuario podrá iniciar sesión en ContentPilot con acceso completo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="new-username">Usuario</Label>
            <Input
              id="new-username"
              placeholder="nombre_usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              minLength={3}
              maxLength={64}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">Contraseña</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || !username || !password}>
              {create.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creando…</>
              ) : (
                "Crear usuario"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteUserButton({ user, selfUsername }: { user: AdminUser; selfUsername?: string }) {
  const del = useDeleteAdminUser()
  const { toast } = useToast()
  const isSelf = user.username === selfUsername

  if (isSelf) return null

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive h-8 w-8"
          title="Eliminar usuario"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción eliminará al usuario <strong>@{user.username}</strong> permanentemente.
            No podrá iniciar sesión.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() =>
              del.mutate(
                { id: user.id },
                {
                  onSuccess: () =>
                    toast({ title: "Usuario eliminado", description: `@${user.username} fue eliminado.` }),
                  onError: (err: any) =>
                    toast({
                      title: "Error",
                      description: err?.data?.error ?? "No se pudo eliminar el usuario",
                      variant: "destructive",
                    }),
                }
              )
            }
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default function Users() {
  const { data: users, isLoading, error } = useAdminUsers()
  const { data: authData } = useAuthStatus()
  const selfUsername = authData?.user?.username

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Usuarios administradores</h1>
            <p className="text-sm text-muted-foreground">
              Gestiona quién puede acceder a ContentPilot
            </p>
          </div>
        </div>
        <AddUserDialog />
      </div>

      {/* Users list */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Cargando usuarios…</span>
          </div>
        )}

        {error && (
          <div className="py-12 text-center text-destructive text-sm">
            Error al cargar usuarios
          </div>
        )}

        {!isLoading && !error && users?.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No hay usuarios registrados
          </div>
        )}

        {!isLoading && !error && users && users.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-5 py-3 font-medium text-muted-foreground">Usuario</th>
                <th className="text-left px-5 py-3 font-medium text-muted-foreground">Rol</th>
                <th className="text-left px-5 py-3 font-medium text-muted-foreground">Creado</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => (
                <tr
                  key={user.id}
                  className={`border-b border-border last:border-0 transition-colors hover:bg-muted/20 ${
                    i % 2 === 0 ? "" : "bg-muted/5"
                  }`}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">
                          {user.username}
                          {user.username === selfUsername && (
                            <span className="ml-2 text-[10px] font-normal text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                              tú
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant="secondary" className="capitalize text-xs">
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    <DeleteUserButton user={user} selfUsername={selfUsername} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info note */}
      <p className="text-xs text-muted-foreground text-center">
        Todos los usuarios tienen acceso de administrador completo a ContentPilot.
      </p>
    </div>
  )
}
