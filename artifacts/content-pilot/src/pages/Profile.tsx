import { useState, useRef } from "react"
import { useAuthStatus, useUpdateProfile, useChangePassword } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { User, KeyRound, Loader2, Save, Camera } from "lucide-react"
import { useUpload } from "@workspace/object-storage-web"

export default function Profile() {
  const { data: auth } = useAuthStatus()
  const user = auth?.user
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Profile fields — seed from current data
  const [fullName, setFullName] = useState(user?.fullName ?? "")
  const [email, setEmail]       = useState(user?.email ?? "")
  const [phone, setPhone]       = useState(user?.phone ?? "")

  // Password fields
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword]         = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  // Local avatar preview (before saving)
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null)

  const updateProfile  = useUpdateProfile()
  const changePassword = useChangePassword()

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response) => {
      const objectPath = response.objectPath
      updateProfile.mutate(
        { avatarUrl: objectPath },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["auth", "me"] })
            toast({ title: "Foto actualizada" })
          },
          onError: () => toast({ title: "Error al guardar la foto", variant: "destructive" }),
        }
      )
    },
    onError: () => toast({ title: "Error al subir la foto", variant: "destructive" }),
  })

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Instant local preview
    setLocalAvatarUrl(URL.createObjectURL(file))
    await uploadFile(file)
  }

  const handleProfileSave = () => {
    updateProfile.mutate(
      { fullName: fullName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["auth", "me"] })
          toast({ title: "Perfil actualizado" })
        },
        onError: () => toast({ title: "Error al actualizar el perfil", variant: "destructive" }),
      }
    )
  }

  const handlePasswordChange = () => {
    if (!currentPassword || !newPassword) { toast({ title: "Completa los campos", variant: "destructive" }); return }
    if (newPassword !== confirmPassword)  { toast({ title: "Las contraseñas no coinciden", variant: "destructive" }); return }
    if (newPassword.length < 8)           { toast({ title: "Mínimo 8 caracteres", variant: "destructive" }); return }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
          toast({ title: "Contraseña actualizada" })
        },
        onError: (err: any) => toast({
          title: "Error",
          description: err?.message ?? "Contraseña actual incorrecta.",
          variant: "destructive",
        }),
      }
    )
  }

  const displayName = user?.fullName || user?.username || "?"
  const initials    = displayName.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)
  const avatarSrc   = localAvatarUrl ?? (user?.avatarUrl ? `/api/storage${user.avatarUrl}` : null)

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-2">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <User className="w-6 h-6 text-primary" />
          Mi Perfil
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Administra tu información personal y contraseña.</p>
      </div>

      {/* Avatar card */}
      <Card>
        <CardContent className="p-6 flex items-center gap-5">
          {/* Clickable avatar */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="relative group shrink-0 focus:outline-none"
            title="Cambiar foto"
          >
            <div className="w-20 h-20 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center text-primary font-bold text-3xl ring-2 ring-border">
              {avatarSrc ? (
                <img src={avatarSrc} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            {/* Hover overlay */}
            <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isUploading
                ? <Loader2 className="w-5 h-5 text-white animate-spin" />
                : <Camera className="w-5 h-5 text-white" />
              }
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div>
            <p className="text-lg font-semibold">{displayName}</p>
            <p className="text-sm text-muted-foreground capitalize">{user?.role}</p>
            {user?.email && <p className="text-sm text-muted-foreground">{user.email}</p>}
            <p className="text-xs text-muted-foreground/60 mt-1">Haz clic en la foto para cambiarla</p>
          </div>
        </CardContent>
      </Card>

      {/* Edit info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información personal</CardTitle>
          <CardDescription>Tu nombre e información de contacto.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Tu nombre" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Teléfono</Label>
            <Input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
          </div>
          <div className="pt-2">
            <Button onClick={handleProfileSave} disabled={updateProfile.isPending} className="gap-2">
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar cambios
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            Cambiar contraseña
          </CardTitle>
          <CardDescription>Usa una contraseña fuerte de al menos 8 caracteres.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPwd">Contraseña actual</Label>
            <Input id="currentPwd" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <Separator />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="newPwd">Nueva contraseña</Label>
              <Input id="newPwd" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPwd">Confirmar contraseña</Label>
              <Input id="confirmPwd" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </div>
          </div>
          <div className="pt-2">
            <Button onClick={handlePasswordChange} disabled={changePassword.isPending} variant="outline" className="gap-2">
              {changePassword.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Cambiar contraseña
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
