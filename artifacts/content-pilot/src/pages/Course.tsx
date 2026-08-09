import { useState, useMemo, useRef, useEffect } from "react"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import {
  useGetCourseProgress,
  useMarkLessonComplete,
  useUnmarkLessonComplete,
} from "@workspace/api-client-react"
import {
  CheckCircle2,
  Circle,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ExternalLink,
  Loader2,
  BookOpen,
  Clock,
  Trophy,
  Zap,
} from "lucide-react"
import { COURSE_MODULES, ALL_LESSONS, TOTAL_LESSONS, getNextLesson, type Lesson, type Module } from "@/data/course"

// ── Video placeholder ─────────────────────────────────────────────────────────
function VideoPlaceholder({ videoUrl, title }: { videoUrl: string | null; title: string }) {
  if (videoUrl) {
    return (
      <div className="w-full aspect-video rounded-xl overflow-hidden bg-black">
        <iframe
          src={videoUrl}
          title={title}
          className="w-full h-full"
          allowFullScreen
        />
      </div>
    )
  }
  return (
    <div className="w-full aspect-video rounded-xl bg-muted/50 border-2 border-dashed border-muted-foreground/20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <PlayCircle className="w-8 h-8 text-muted-foreground/40" />
      </div>
      <div className="text-center">
        <p className="font-medium text-sm">Clase próximamente</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">Video en producción</p>
      </div>
    </div>
  )
}

// ── Lesson detail pane ────────────────────────────────────────────────────────
function LessonDetail({
  lesson,
  moduleNumber,
  lessonIndex,
  completed,
  onMark,
  onUnmark,
  onNext,
  hasNext,
  isPending,
}: {
  lesson: Lesson
  moduleNumber: number
  lessonIndex: number
  completed: boolean
  onMark: () => void
  onUnmark: () => void
  onNext: () => void
  hasNext: boolean
  isPending: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Módulo {moduleNumber} · Clase {lessonIndex}
          </Badge>
          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />{lesson.duration}
          </Badge>
          {completed && (
            <Badge className="text-xs gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800">
              <CheckCircle2 className="w-3 h-3" /> Completada
            </Badge>
          )}
        </div>
        <h2 className="text-2xl font-display font-bold tracking-tight leading-snug">{lesson.title}</h2>
      </div>

      {/* Video */}
      <VideoPlaceholder videoUrl={lesson.videoUrl} title={lesson.title} />

      {/* Description */}
      <p className="text-muted-foreground leading-relaxed">{lesson.description}</p>

      {/* Checklist (clase 23) */}
      {lesson.checklistItems && lesson.checklistItems.length > 0 && (
        <div className="rounded-xl border bg-muted/30 p-5 space-y-2">
          <p className="font-semibold text-sm mb-3">Checklist de lanzamiento</p>
          {lesson.checklistItems.map((item, i) => (
            <p key={i} className="text-sm text-muted-foreground">{item}</p>
          ))}
        </div>
      )}

      {/* Practical action */}
      {lesson.actionLabel && lesson.actionHref && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-2">Acción práctica</p>
          <p className="text-sm text-muted-foreground mb-4">
            Ponelo en práctica ahora mismo dentro de la herramienta.
          </p>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href={lesson.actionHref}>
              <ExternalLink className="w-4 h-4" />
              {lesson.actionLabel}
            </Link>
          </Button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap pt-2 border-t">
        {!completed ? (
          <Button onClick={onMark} disabled={isPending} className="gap-2 shadow-sm shadow-primary/20">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Marcar como completada
          </Button>
        ) : (
          <Button variant="outline" onClick={onUnmark} disabled={isPending} className="gap-2 text-muted-foreground">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            Completada · desmarcar
          </Button>
        )}
        {hasNext && (
          <Button variant={completed ? "default" : "ghost"} onClick={onNext} className="gap-2 ml-auto">
            Siguiente clase <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Module row in sidebar ─────────────────────────────────────────────────────
function ModuleRow({
  module,
  completedIds,
  selectedId,
  onSelect,
}: {
  module: Module
  completedIds: Set<string>
  selectedId: string
  onSelect: (id: string) => void
}) {
  const completedCount = module.lessons.filter((l) => completedIds.has(l.id)).length
  const isModuleDone = completedCount === module.lessons.length
  const isOpen = module.lessons.some((l) => l.id === selectedId)
  const [open, setOpen] = useState(isOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
      >
        <span className={cn(
          "w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0",
          isModuleDone
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            : "bg-primary/10 text-primary"
        )}>
          {isModuleDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : module.number}
        </span>
        <span className="flex-1 text-sm font-semibold leading-snug text-foreground">
          {module.title}
        </span>
        <span className="text-[11px] text-muted-foreground mr-1">{completedCount}/{module.lessons.length}</span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="ml-3 pl-3 border-l border-border/60 flex flex-col gap-0.5 mb-1">
          {module.lessons.map((lesson) => {
            const done = completedIds.has(lesson.id)
            const active = lesson.id === selectedId
            return (
              <button
                key={lesson.id}
                type="button"
                onClick={() => onSelect(lesson.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                )}
              >
                {done
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  : <Circle className="w-3.5 h-3.5 shrink-0 opacity-40" />}
                <span className="text-xs leading-snug">{lesson.title}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Course() {
  const { data, isLoading } = useGetCourseProgress()
  const markComplete = useMarkLessonComplete()
  const unmark = useUnmarkLessonComplete()

  const completedIds = useMemo(
    () => new Set(data?.completedLessons ?? []),
    [data?.completedLessons]
  )

  const completedCount = completedIds.size
  const progressPct = Math.round((completedCount / TOTAL_LESSONS) * 100)
  const nextLesson = getNextLesson(completedIds)

  // Default selection: next incomplete lesson, or first lesson
  const [selectedId, setSelectedId] = useState<string>(() => ALL_LESSONS[0].id)

  // Ref for the lesson detail panel — used to scroll into view on mobile
  const lessonDetailRef = useRef<HTMLDivElement>(null)

  // On mobile (< lg = 1024px), scroll to lesson detail whenever selection changes
  // Skip the very first render (no user interaction yet)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (window.innerWidth < 1024 && lessonDetailRef.current) {
      lessonDetailRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [selectedId])

  const selectedLesson = ALL_LESSONS.find((l) => l.id === selectedId) ?? ALL_LESSONS[0]
  const selectedModule = COURSE_MODULES.find((m) => m.lessons.some((l) => l.id === selectedId))!
  const lessonIndexInModule = selectedModule.lessons.findIndex((l) => l.id === selectedId) + 1

  const currentIdx = ALL_LESSONS.findIndex((l) => l.id === selectedId)
  const nextInList = currentIdx < ALL_LESSONS.length - 1 ? ALL_LESSONS[currentIdx + 1] : null

  const handleMark = () => {
    markComplete.mutate(selectedId, {
      onSuccess: () => {
        if (nextInList) setSelectedId(nextInList.id)
      },
    })
  }
  const handleUnmark = () => unmark.mutate(selectedId)
  const handleNext = () => { if (nextInList) setSelectedId(nextInList.id) }

  const isPending = markComplete.isPending || unmark.isPending

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">Implementación guiada</h1>
          <p className="text-muted-foreground mt-1">Configurá tu máquina de contenido con avatar, paso a paso.</p>
        </div>
        {completedCount > 0 && (
          <Badge variant="outline" className="self-start sm:self-auto gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
            <Trophy className="w-3.5 h-3.5" /> {completedCount} de {TOTAL_LESSONS} completadas
          </Badge>
        )}
      </div>

      {/* Progress bar */}
      <div className="rounded-xl border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando progreso…
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Progreso del curso</span>
                <span className="text-sm font-bold text-primary">{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                {completedCount} de {TOTAL_LESSONS} clases completadas
              </p>
            </div>
            {nextLesson && (
              <div className="flex items-center gap-3 sm:border-l sm:pl-5 shrink-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Siguiente</p>
                  <button
                    type="button"
                    onClick={() => setSelectedId(nextLesson.id)}
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors text-left max-w-[200px] truncate block"
                  >
                    {nextLesson.title}
                  </button>
                </div>
              </div>
            )}
            {progressPct === 100 && (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm sm:border-l sm:pl-5">
                <Trophy className="w-5 h-5" /> ¡Curso completado!
              </div>
            )}
          </>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
        {/* Sidebar — module/lesson list */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Módulos del curso</span>
          </div>
          <div className="p-2 flex flex-col gap-0.5 max-h-[calc(100vh-320px)] overflow-y-auto">
            {COURSE_MODULES.map((module) => (
              <ModuleRow
                key={module.id}
                module={module}
                completedIds={completedIds}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </div>

        {/* Lesson detail */}
        <div ref={lessonDetailRef} className="rounded-xl border bg-card shadow-sm p-6 min-h-[400px] scroll-mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Cargando…
            </div>
          ) : (
            <LessonDetail
              lesson={selectedLesson}
              moduleNumber={selectedModule.number}
              lessonIndex={lessonIndexInModule}
              completed={completedIds.has(selectedId)}
              onMark={handleMark}
              onUnmark={handleUnmark}
              onNext={handleNext}
              hasNext={!!nextInList}
              isPending={isPending}
            />
          )}
        </div>
      </div>
    </div>
  )
}
