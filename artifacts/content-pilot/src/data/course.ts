export interface Lesson {
  id: string
  title: string
  description: string
  duration: string        // e.g. "8 min"
  videoUrl: string | null // null = placeholder
  actionLabel: string | null
  actionHref: string | null
  checklistItems?: string[]
}

export interface Module {
  id: string
  number: number
  title: string
  lessons: Lesson[]
}

export const COURSE_MODULES: Module[] = [
  {
    id: "m1",
    number: 1,
    title: "Fundamentos de la máquina de contenido con avatar",
    lessons: [
      {
        id: "m1-l1",
        title: "Qué vas a construir con Reelsona",
        description:
          "Entendé el sistema completo: avatar, estrategia, guiones, captions, publicación y mejora continua. Antes de tocar cualquier botón, necesitás tener claro qué hace cada pieza del sistema y cómo encajan.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Ver Dashboard",
        actionHref: "/",
      },
      {
        id: "m1-l2",
        title: "Qué tipo de contenido funciona con un avatar talking-head",
        description:
          "Aprendé qué formatos funcionan mejor: opinión experta, errores comunes, mitos del nicho, frameworks, checklists verbales, historias y manejo de objeciones. Entendé también por qué los tutoriales que dependen de compartir pantalla no son el formato indicado para un avatar.",
        duration: "10 min",
        videoUrl: null,
        actionLabel: "Ir a Auditoría",
        actionHref: "/audit",
      },
      {
        id: "m1-l3",
        title: "Costos y APIs que debés conectar",
        description:
          "Reelsona organiza el sistema, pero vos usás tus propias APIs de HeyGen y OpenAI. Acá te explicamos cómo funciona el modelo BYOK (trae tu propia clave), qué cuesta en promedio y cómo controlarlo.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Ir a Configuración",
        actionHref: "/settings",
      },
    ],
  },
  {
    id: "m2",
    number: 2,
    title: "Configuración técnica esencial",
    lessons: [
      {
        id: "m2-l4",
        title: "Crear o preparar tu cuenta de HeyGen",
        description:
          "HeyGen es el motor de avatar. Necesitás una cuenta con acceso a la API, créditos suficientes y al menos un avatar personalizado o de stock. Acá te mostramos dónde conseguir tu API key y cómo pegarla en Reelsona.",
        duration: "9 min",
        videoUrl: null,
        actionLabel: "Configurar HeyGen",
        actionHref: "/settings",
      },
      {
        id: "m2-l5",
        title: "Conectar OpenAI o ChatGPT API",
        description:
          "OpenAI potencia la generación de ideas, guiones, estrategia y captions. Explicamos por qué conviene usar tu propia clave API para tener control del gasto. Si la conexión directa de OpenAI todavía no está disponible en tu cuenta, esta clase te deja preparado para cuando llegue.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Ir a Configuración",
        actionHref: "/settings",
      },
      {
        id: "m2-l6",
        title: "Elegir y probar tu avatar",
        description:
          "Seleccioná avatares y looks, asigná una voz y hacé una prueba corta de video antes de lanzar producción. Esto te ahorrará créditos de HeyGen al detectar problemas temprano.",
        duration: "10 min",
        videoUrl: null,
        actionLabel: "Ir a Avatares",
        actionHref: "/avatars",
      },
      {
        id: "m2-l7",
        title: "Conectar Instagram de forma segura",
        description:
          "Aprendé qué permisos necesita Reelsona, por qué necesitás una cuenta profesional (Creador o Empresa), cuáles son los límites de la API de Meta y cómo funciona la publicación manual vs automática.",
        duration: "11 min",
        videoUrl: null,
        actionLabel: "Conectar Instagram",
        actionHref: "/connect",
      },
    ],
  },
  {
    id: "m3",
    number: 3,
    title: "Estrategia antes de crear contenido",
    lessons: [
      {
        id: "m3-l8",
        title: "Definir nicho, audiencia y oferta",
        description:
          "Completá los datos que Reelsona usa para estudiar el mercado y generar contenido relevante. Sin esta configuración, los guiones y temas van a ser genéricos y poco efectivos.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Completar Configuración",
        actionHref: "/settings",
      },
      {
        id: "m3-l9",
        title: "Ejecutar Auditoría y Estudio de Mercado",
        description:
          "Recorré los 5 pasos del Estudio Estratégico: análisis de tu cuenta, Radar de Nicho, Estudio de Mercado, Estrategia y Generación de Plan. Cada paso alimenta al siguiente.",
        duration: "12 min",
        videoUrl: null,
        actionLabel: "Ir a Auditoría",
        actionHref: "/audit",
      },
      {
        id: "m3-l10",
        title: "Entender tu estrategia de contenido",
        description:
          "Aprendé a leer los pilares de contenido, ángulos, dolores de audiencia, formatos recomendados y oportunidades detectadas por el sistema. Esta lectura define qué creás las próximas semanas.",
        duration: "9 min",
        videoUrl: null,
        actionLabel: "Ver Estrategia",
        actionHref: "/audit",
      },
    ],
  },
  {
    id: "m4",
    number: 4,
    title: "Crear los primeros Reels",
    lessons: [
      {
        id: "m4-l11",
        title: "Generar tu primer plan de contenido",
        description:
          "Creá temas basados en tu estrategia, no desde cero. El sistema propone tópicos con viral score, fit con el avatar y diferenciación respecto a la competencia.",
        duration: "9 min",
        videoUrl: null,
        actionLabel: "Ir a Plan de Contenido",
        actionHref: "/content",
      },
      {
        id: "m4-l12",
        title: "Revisar temas con viral score y ajuste al avatar",
        description:
          "Entendé qué significa el viral_score, el visual_dependency y el format_fit_score de cada tema. Aprendé por qué algunos temas son más compartibles que otros y cómo priorizarlos.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Revisar Plan",
        actionHref: "/content",
      },
      {
        id: "m4-l13",
        title: "Crear y aprobar tu primer guion",
        description:
          "Revisá el hook de apertura, el desarrollo del guion y el CTA final. Aprendé a ajustar el tono para que suene natural con tu avatar y tu audiencia.",
        duration: "11 min",
        videoUrl: null,
        actionLabel: "Generar Guion",
        actionHref: "/content",
      },
      {
        id: "m4-l14",
        title: "Generar tu primer video con avatar",
        description:
          "Enviá el guion aprobado a HeyGen y entendé los estados del video: generando, listo, error. Cuánto tarda, qué créditos consume y cómo revisar el resultado.",
        duration: "10 min",
        videoUrl: null,
        actionLabel: "Generar Video",
        actionHref: "/content",
      },
    ],
  },
  {
    id: "m5",
    number: 5,
    title: "Captions, edición y calidad",
    lessons: [
      {
        id: "m5-l15",
        title: "Configurar Caption Studio",
        description:
          "Elegí tu estilo de captions y entendé la diferencia entre el motor estándar y el experimental. El estilo visual de los captions impacta directamente en retención y branding.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Ir a Caption Studio",
        actionHref: "/captions",
      },
      {
        id: "m5-l16",
        title: "Revisar el video final antes de publicar",
        description:
          "Antes de publicar, chequeá: calidad del avatar, audio limpio, captions correctos, sin errores visuales y CTA visible. Esta revisión evita publicar contenido con fallas.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Ir a Videos",
        actionHref: "/videos",
      },
      {
        id: "m5-l17",
        title: "Evaluar calidad del avatar y del Reel",
        description:
          "Entendé cómo el sistema aprende de la calidad de tus videos. En el futuro podrás dar feedback por video (pulgar arriba/abajo) para que el sistema mejore la selección de looks y ángulos.",
        duration: "6 min",
        videoUrl: null,
        actionLabel: "Ir a Videos",
        actionHref: "/videos",
      },
    ],
  },
  {
    id: "m6",
    number: 6,
    title: "Publicación y automatización",
    lessons: [
      {
        id: "m6-l18",
        title: "Publicar manualmente tu primer Reel",
        description:
          "Publicá tu primer Reel con control total antes de activar la automatización. Verificá que Instagram lo recibe bien, que los captions se ven bien en móvil y que el engagement inicial es el esperado.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Ir a Videos",
        actionHref: "/videos",
      },
      {
        id: "m6-l19",
        title: "Configurar calendario y automatización",
        description:
          "Programá los horarios de publicación, entendé cómo funciona la generación automática de contenido y cuáles son los límites recomendados para no saturar a tu audiencia.",
        duration: "10 min",
        videoUrl: null,
        actionLabel: "Configurar Automatización",
        actionHref: "/automation",
      },
      {
        id: "m6-l20",
        title: "Rutina semanal de mejora",
        description:
          "Cada semana: revisá métricas, repetí la auditoría estratégica si cambiaron tus objetivos, ajustá la estrategia y generá nuevos contenidos. Esta rutina es lo que separa cuentas que crecen de las que se estancan.",
        duration: "9 min",
        videoUrl: null,
        actionLabel: "Ver Dashboard",
        actionHref: "/",
      },
    ],
  },
  {
    id: "m7",
    number: 7,
    title: "Escalar sin perder calidad",
    lessons: [
      {
        id: "m7-l21",
        title: "Crear variaciones sin aburrir a la audiencia",
        description:
          "Aprendé a variar hooks, ángulos, formatos y soportes visuales para que tu contenido no se vuelva predecible. El sistema sugiere ángulos alternativos para cada tema.",
        duration: "9 min",
        videoUrl: null,
        actionLabel: "Ir a Plan de Contenido",
        actionHref: "/content",
      },
      {
        id: "m7-l22",
        title: "Buenas prácticas para no gastar créditos de más",
        description:
          "Probá con guiones cortos antes de generar videos largos, revisá bien antes de enviar a HeyGen, evitá regeneraciones innecesarias. Con disciplina, el costo por video baja significativamente.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Ir a Configuración",
        actionHref: "/settings",
      },
      {
        id: "m7-l23",
        title: "Checklist final de lanzamiento",
        description:
          "Confirmá que todo está listo antes de lanzar en serio: APIs conectadas, avatar seleccionado, estrategia generada, captions configurados, Instagram conectado, calendario programado y primer Reel publicado.",
        duration: "6 min",
        videoUrl: null,
        actionLabel: null,
        actionHref: null,
        checklistItems: [
          "✅ HeyGen API key conectada",
          "✅ Avatar seleccionado y probado",
          "✅ OpenAI/IA configurada",
          "✅ Instagram conectado (cuenta profesional)",
          "✅ Nicho y audiencia definidos en Configuración",
          "✅ Auditoría estratégica completada",
          "✅ Estrategia generada",
          "✅ Plan de contenido con al menos 5 temas",
          "✅ Caption Studio configurado",
          "✅ Primer video generado y revisado",
          "✅ Primer Reel publicado manualmente",
          "✅ Automatización y calendario activos",
        ],
      },
    ],
  },
]

export const ALL_LESSONS: Lesson[] = COURSE_MODULES.flatMap((m) => m.lessons)
export const TOTAL_LESSONS = ALL_LESSONS.length

export function getNextLesson(completedIds: Set<string>): Lesson | null {
  return ALL_LESSONS.find((l) => !completedIds.has(l.id)) ?? null
}
