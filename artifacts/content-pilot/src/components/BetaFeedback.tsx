import { useState } from "react"
import { Bug, CheckCircle2, Lightbulb, Loader2, MessageSquareText, Send, TriangleAlert } from "lucide-react"
import { useSendFeedback } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type FeedbackCategory = "bug" | "problem" | "feature"
const feedbackOptions = [
  { value: "bug" as const, label: "Encontré un error", description: "Algo no funciona como esperabas.", icon: Bug },
  { value: "problem" as const, label: "Tuve una dificultad", description: "Algo fue confuso o te bloqueó.", icon: TriangleAlert },
  { value: "feature" as const, label: "Tengo una idea", description: "Una función que te gustaría ver.", icon: Lightbulb },
]

export function BetaFeedback() {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<FeedbackCategory>("bug")
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const { toast } = useToast()
  const sendFeedback = useSendFeedback()

  const reset = () => { setCategory("bug"); setMessage(""); setSubmitted(false) }
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (trimmed.length < 10) {
      toast({ title: "Cuéntanos un poco más", description: "Escribe al menos 10 caracteres.", variant: "destructive" })
      return
    }
    sendFeedback.mutate({ data: { category, message: trimmed, page: window.location.pathname } }, {
      onSuccess: () => setSubmitted(true),
      onError: (error: any) => toast({
        title: "No pudimos enviar tu opinión",
        description: error?.data?.error ?? "Intenta de nuevo en unos minutos.",
        variant: "destructive",
      }),
    })
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset() }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-primary/30 bg-primary px-2 py-3 text-primary-foreground shadow-lg transition-all hover:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Compartir opinión sobre Reelsona"
      >
        <MessageSquareText className="h-4 w-4" />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-bold tracking-wide">Feedback</span>
      </button>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MessageSquareText className="h-5 w-5" /></div>
            <SheetTitle>Ayúdanos a mejorar Reelsona</SheetTitle>
          </div>
          <SheetDescription>Tu opinión nos ayuda a priorizar mejoras.</SheetDescription>
        </SheetHeader>
        {submitted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <h3 className="text-lg font-semibold">Opinión enviada</h3>
            <p className="text-sm text-muted-foreground">Gracias por ayudarnos a mejorar Reelsona.</p>
            <Button onClick={() => { setOpen(false); reset() }}>Cerrar</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col pt-6">
            <fieldset>
              <legend className="text-sm font-semibold">¿Qué quieres contarnos?</legend>
              <div className="mt-3 grid gap-2">
                {feedbackOptions.map((option) => {
                  const Icon = option.icon
                  const selected = category === option.value
                  return (
                    <button key={option.value} type="button" onClick={() => setCategory(option.value)} className={cn("flex items-center gap-3 rounded-lg border p-3 text-left transition-colors", selected ? "border-primary bg-primary/10" : "hover:bg-muted")}>
                      <Icon className="h-5 w-5 shrink-0" />
                      <span><span className="block text-sm font-medium">{option.label}</span><span className="block text-xs text-muted-foreground">{option.description}</span></span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div className="mt-6 flex flex-1 flex-col">
              <label htmlFor="feedback-message" className="text-sm font-semibold">Cuéntanos los detalles</label>
              <Textarea id="feedback-message" value={message} onChange={(event) => setMessage(event.target.value.slice(0, 5000))} placeholder="¿Qué pasó? ¿Qué esperabas que ocurriera?" className="mt-2 min-h-36 flex-1 resize-none" maxLength={5000} disabled={sendFeedback.isPending} />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>Tu página actual se incluirá automáticamente.</span><span>{message.length}/5000</span></div>
            </div>
            <Button type="submit" className="mt-6 w-full gap-2" disabled={sendFeedback.isPending || message.trim().length < 10}>
              {sendFeedback.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando opinión…</> : <><Send className="h-4 w-4" /> Enviar opinión</>}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}