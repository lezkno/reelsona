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
    title: "Prepara Reelsona para tu negocio",
    lessons: [
      {
        id: "m1-l1",
        title: "Cómo funciona Reelsona y qué vas a configurar",
        description:
          "Conoce el recorrido completo que vas a implementar: Reelsona entiende tu negocio y tu mercado, crea una estrategia, prepara tus avatares y voces, produce tus Reels y finalmente automatiza la publicación. Esta clase te muestra el mapa antes de comenzar.",
        duration: "5 min",
        videoUrl: null,
        actionLabel: "Ver Dashboard",
        actionHref: "/",
      },
      {
        id: "m1-l2",
        title: "Configura tu negocio, oferta y audiencia",
        description:
          "Completa la información que Reelsona necesita para entender qué haces, qué vendes, a quién ayudas, cuál es tu propuesta de valor, qué problemas resuelves, qué tono quieres usar y qué acción quieres que tome tu audiencia.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Configurar mi negocio",
        actionHref: "/settings",
      },
      {
        id: "m1-l3",
        title: "Entiende tus créditos y controla tu consumo",
        description:
          "Aprende cómo funcionan los créditos de Reelsona, cómo influye la duración del Reel en el consumo, qué incluye la producción y cómo administrar tu saldo para producir contenido durante todo el mes sin regeneraciones innecesarias.",
        duration: "5 min",
        videoUrl: null,
        actionLabel: "Ver mi configuración",
        actionHref: "/settings",
      },
    ],
  },
  {
    id: "m2",
    number: 2,
    title: "Haz que Reelsona entienda tu negocio y tu mercado",
    lessons: [
      {
        id: "m2-l4",
        title: "Conecta tu cuenta de Instagram",
        description:
          "Conecta tu cuenta profesional de Instagram para que Reelsona pueda analizar tu presencia actual, utilizar la información disponible de tu cuenta y preparar posteriormente la publicación de tus Reels. También entenderás los permisos necesarios y cómo funciona la conexión.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Conectar Instagram",
        actionHref: "/connect",
      },
      {
        id: "m2-l5",
        title: "Ejecuta la auditoría de tu cuenta",
        description:
          "Analiza tu punto de partida antes de crear contenido. Reelsona revisa la información disponible de tu cuenta para identificar patrones, oportunidades y señales que ayudarán a construir una estrategia más alineada con tu situación actual.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Ejecutar Auditoría",
        actionHref: "/audit",
      },
      {
        id: "m2-l6",
        title: "Ejecuta el Radar y Estudio de Mercado",
        description:
          "Haz que Reelsona estudie tu nicho, competidores, temas, patrones de contenido y oportunidades. Sigue el proceso paso a paso para alimentar al sistema con contexto real antes de generar tu estrategia y tus primeros contenidos.",
        duration: "10 min",
        videoUrl: null,
        actionLabel: "Estudiar mi mercado",
        actionHref: "/audit",
      },
      {
        id: "m2-l7",
        title: "Revisa tu estrategia personalizada",
        description:
          "Revisa los pilares, ángulos, dolores, oportunidades, tono y recomendaciones que Reelsona preparó para tu negocio. El objetivo no es estudiar marketing, sino confirmar que el sistema entendió correctamente tu marca antes de comenzar a producir.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Ver mi Estrategia",
        actionHref: "/audit",
      },
    ],
  },
  {
    id: "m3",
    number: 3,
    title: "Configura tus Avatares y Voces",
    lessons: [
      {
        id: "m3-l8",
        title: "Conoce los dos tipos de avatares de Reelsona",
        description:
          "Entiende cuándo utilizar tu propio Avatar AI y cuándo utilizar los avatares públicos disponibles en Reelsona. Aprende cómo pueden convivir dentro de tu estrategia y cómo elegir la opción adecuada según el tipo de contenido que quieras producir.",
        duration: "5 min",
        videoUrl: null,
        actionLabel: "Ir a Avatares",
        actionHref: "/avatars",
      },
      {
        id: "m3-l9",
        title: "Crea tu Avatar AI",
        description:
          "Crea tu identidad digital paso a paso. Aprende qué foto de referencia utilizar, cómo cuidar encuadre, iluminación, postura y visibilidad de las manos para conseguir un Avatar AI natural y preparado para contenido vertical.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Crear mi Avatar AI",
        actionHref: "/avatars",
      },
      {
        id: "m3-l10",
        title: "Genera y selecciona tus Looks",
        description:
          "Genera diferentes apariencias para tu Avatar AI y selecciona las que utilizarás en tus contenidos. Aprende cómo los looks Profesional, Cercano y Dinámico ayudan a variar la presencia visual sin perder tu identidad.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Configurar Looks",
        actionHref: "/avatars",
      },
      {
        id: "m3-l11",
        title: "Clona y configura tu voz",
        description:
          "Crea tu voz dentro de Reelsona a partir de una muestra limpia y comprueba pronunciación, ritmo y naturalidad. Al finalizar tendrás una voz lista para asignarla a tus avatares y looks.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Configurar mi Voz",
        actionHref: "/avatars",
      },
      {
        id: "m3-l12",
        title: "Asigna una voz a cada Avatar y Look",
        description:
          "Aprende a seleccionar la voz que utilizará cada avatar y cada look, guardar correctamente la asignación y comprobar que Reelsona sabe qué voz utilizar cuando genere un Reel. Repite el proceso cuando trabajes con varias identidades o apariencias.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Asignar Voces",
        actionHref: "/avatars",
      },
      {
        id: "m3-l13",
        title: "Configura y utiliza Avatares Públicos",
        description:
          "Explora los avatares públicos, previsualiza las opciones, selecciona los que quieras utilizar y aprende a asignarles una voz. Verás también cómo combinar avatares públicos con tu Avatar AI dentro de tu estrategia de contenido.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Ver Avatares Públicos",
        actionHref: "/avatars",
      },
      {
        id: "m3-l14",
        title: "Haz una prueba corta de tu Avatar",
        description:
          "Antes de producir un Reel completo, realiza una prueba corta para comprobar identidad, movimiento, manos, sincronización labial, voz, pronunciación, look y encuadre. Corrige cualquier detalle ahora para evitar gastar créditos en regeneraciones posteriores.",
        duration: "7 min",
        videoUrl: null,
        actionLabel: "Probar mi Avatar",
        actionHref: "/content",
      },
    ],
  },
  {
    id: "m4",
    number: 4,
    title: "Crea y publica tu primer Reel",
    lessons: [
      {
        id: "m4-l15",
        title: "Genera tu primer plan de contenido",
        description:
          "Convierte la estrategia que Reelsona ya aprendió en temas concretos para tus próximos Reels. Revisa las recomendaciones y las señales de potencial de cada tema, y selecciona una idea adecuada para producir tu primer contenido.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Generar Plan de Contenido",
        actionHref: "/content",
      },
      {
        id: "m4-l16",
        title: "Selecciona un tema y crea tu primer guion",
        description:
          "Selecciona uno de los temas propuestos y genera el guion. Revisa el hook, desarrollo y CTA, haz los ajustes que necesites y confirma que el mensaje representa tu forma de comunicar antes de enviarlo a producción.",
        duration: "9 min",
        videoUrl: null,
        actionLabel: "Crear mi Guion",
        actionHref: "/content",
      },
      {
        id: "m4-l17",
        title: "Configura el estilo visual de tus Reels",
        description:
          "Configura Caption Studio y las opciones visuales que acompañarán tus videos. Elige el estilo de captions y aprende cómo utilizar B-roll y movimiento para que tus Reels tengan una presentación consistente con tu marca.",
        duration: "8 min",
        videoUrl: null,
        actionLabel: "Configurar Caption Studio",
        actionHref: "/captions",
      },
      {
        id: "m4-l18",
        title: "Genera, revisa y publica tu primer Reel",
        description:
          "Genera tu primer Reel completo y revisa avatar, voz, B-roll, captions y mensaje antes de publicarlo. Después completa el ciclo enviándolo a Instagram y confirma que el resultado final se ve correctamente en móvil.",
        duration: "10 min",
        videoUrl: null,
        actionLabel: "Ir a mis Videos",
        actionHref: "/videos",
      },
    ],
  },
  {
    id: "m5",
    number: 5,
    title: "Activa tu máquina de contenido",
    lessons: [
      {
        id: "m5-l19",
        title: "Configura calendario y activa AutoPilot",
        description:
          "Define frecuencia, días y horarios de publicación y activa las automatizaciones que quieras delegar. Aprende cómo Reelsona pasa de estrategia a guion, producción, edición y publicación para mantener tu calendario funcionando con mínima intervención.",
        duration: "10 min",
        videoUrl: null,
        actionLabel: "Activar AutoPilot",
        actionHref: "/automation",
      },
      {
        id: "m5-l20",
        title: "Tu rutina semanal de 15 minutos",
        description:
          "Aprende la rutina mínima para mantener el sistema saludable: revisar lo publicado, observar resultados, comprobar el calendario y ajustar estrategia u objetivos cuando sea necesario. Reelsona automatiza la operación, pero tus decisiones siguen guiando la dirección.",
        duration: "6 min",
        videoUrl: null,
        actionLabel: "Ver Dashboard",
        actionHref: "/",
      },
      {
        id: "m5-l21",
        title: "Checklist final: tu Reelsona está lista",
        description:
          "Completa esta revisión final para confirmar que tu máquina de contenido está preparada para trabajar: negocio configurado, mercado estudiado, identidad digital lista, primer Reel publicado y automatización configurada.",
        duration: "5 min",
        videoUrl: null,
        actionLabel: null,
        actionHref: null,
        checklistItems: [
          "✅ Información del negocio, oferta y audiencia completada",
          "✅ Instagram conectado",
          "✅ Auditoría de la cuenta completada",
          "✅ Radar y Estudio de Mercado completados",
          "✅ Estrategia personalizada revisada",
          "✅ Avatar AI configurado o avatares públicos seleccionados",
          "✅ Looks seleccionados",
          "✅ Voz configurada y asignada a cada avatar que vas a utilizar",
          "✅ Prueba corta de avatar completada",
          "✅ Plan de contenido generado",
          "✅ Caption Studio y estilo visual configurados",
          "✅ Primer Reel generado, revisado y publicado",
          "✅ Calendario configurado",
          "✅ AutoPilot configurado según tu plan",
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
