import { Sparkles, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"

export type AvatarQuality = "standard" | "premium"

interface Props {
  value: AvatarQuality
  onChange: (value: AvatarQuality) => void
  /** Credits for this reel in each mode (omit to show the generic per-60 s guide). */
  creditsStandard?: number
  creditsPremium?: number
  disabled?: boolean
}

const OPTIONS: Array<{
  value: AvatarQuality
  title: string
  description: string
  guide: string
  icon: typeof UserRound
}> = [
  {
    value: "standard",
    title: "Estándar",
    description: "Avatar hablando a cámara, plano fijo. Rápido y económico.",
    guide: "≈ 100 créditos por reel de 60 s",
    icon: UserRound,
  },
  {
    value: "premium",
    title: "Premium",
    description: "Escenas dinámicas: cambios de plano, movimiento y gestos naturales.",
    guide: "≈ 115 créditos por reel de 60 s · se cobra según las escenas",
    icon: Sparkles,
  },
]

/** Two-option selector for the avatar video quality (InfiniteTalk vs WAN 3.0). */
export default function AvatarQualityPicker({ value, onChange, creditsStandard, creditsPremium, disabled }: Props) {
  return (
    <div role="radiogroup" aria-label="Calidad del avatar" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map((opt) => {
        const selected = value === opt.value
        const credits = opt.value === "premium" ? creditsPremium : creditsStandard
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors disabled:opacity-60",
              selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50",
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
              {opt.title}
            </span>
            <span className="text-sm text-muted-foreground">{opt.description}</span>
            <span className={cn("text-xs font-medium", selected ? "text-primary" : "text-muted-foreground")}>
              {credits != null ? `≈ ${credits} créditos este reel` : opt.guide}
            </span>
          </button>
        )
      })}
    </div>
  )
}
