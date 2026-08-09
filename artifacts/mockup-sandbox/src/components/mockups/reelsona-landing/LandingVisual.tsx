import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Brain,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  FilePen,
  Instagram,
  Layers,
  MessageSquare,
  Play,
  Rocket,
  Settings2,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Video,
  X,
  Zap,
} from "lucide-react";

const BASE_IMG = "/__mockup/images";

// --- Global Styles & Hooks ---

const fontStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

  :root {
    --bg-base: #090909;
    --brand-blue: #4F6EF7;
    --brand-purple: #9B5CF6;
  }

  body {
    background-color: var(--bg-base);
    color: #f0f0f0;
    font-family: 'Plus Jakarta Sans', sans-serif;
  }

  h1, h2, h3, h4, h5, h6, .font-display {
    font-family: 'Outfit', sans-serif;
  }

  .reveal-up {
    opacity: 0;
    transform: translateY(30px);
    transition: all 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .reveal-up.is-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .stagger-1 { transition-delay: 100ms; }
  .stagger-2 { transition-delay: 200ms; }
  .stagger-3 { transition-delay: 300ms; }

  .bg-grid-pattern {
    background-image: 
      linear-gradient(rgba(79, 110, 247, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(79, 110, 247, 0.05) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  .glow-blue {
    box-shadow: 0 0 80px rgba(79, 110, 247, 0.15);
  }

  .glow-purple {
    box-shadow: 0 0 80px rgba(155, 92, 246, 0.15);
  }
    
  .node-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
    
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .5; }
  }
`;

function useRevealObserver() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );

    document.querySelectorAll(".reveal-up").forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);
}

// --- Shared Components ---

const ButtonPrimary = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <button
    className={`inline-flex items-center gap-2 rounded-xl font-bold transition-all hover:scale-105 active:scale-95 ${className}`}
    style={{
      background: "linear-gradient(135deg, #4F6EF7, #7B5CF6)",
      color: "#fff",
      padding: "1rem 2.1rem",
      fontSize: "1.05rem",
      border: "none",
      boxShadow: "0 0 28px rgba(79,110,247,0.35)",
    }}
  >
    {children}
  </button>
);

const FloatingPill = ({ icon, text, className = "", delay = "0s" }: { icon: React.ReactNode, text: string, className?: string, delay?: string }) => (
  <div
    className={`absolute backdrop-blur-xl bg-black/50 border border-white/10 rounded-full px-4 py-2 flex items-center gap-2 text-sm shadow-2xl reveal-up ${className}`}
    style={{ animationDelay: delay }}
  >
    <div className="text-[#4F6EF7]">{icon}</div>
    <span className="font-semibold text-white/90 whitespace-nowrap">{text}</span>
  </div>
);

// --- Section Components ---

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20 pb-20">
      {/* Background Textures */}
      <div className="absolute inset-0 bg-grid-pattern opacity-50 pointer-events-none" />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(79,110,247,0.15) 0%, transparent 60%)",
        }}
      />

      <div className="max-w-7xl mx-auto px-6 w-full relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          
          {/* Copy Side */}
          <div className="reveal-up">
            <div className="inline-flex items-center gap-2 rounded-full text-xs font-bold tracking-widest uppercase mb-8 px-4 py-1.5 bg-[#4F6EF7]/10 border border-[#4F6EF7]/20 text-[#4F6EF7]">
              <Sparkles size={14} />
              Reelsona Autopilot
            </div>

            <h1 className="font-display font-bold text-5xl lg:text-7xl tracking-tight leading-[1.05] mb-6 text-white">
              Monta tu sistema automático de Reels{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-br from-[#4F6EF7] to-[#9B5CF6]">
                sin grabarte todos los días
              </span>
            </h1>

            <p className="text-lg lg:text-xl text-gray-400 leading-relaxed max-w-lg mb-8">
              La capa estratégica y operativa que convierte tu conocimiento en ideas,
              guiones, videos con avatar, captions, edición y publicación en Instagram —
              completamente en automático.
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-10">
              <ButtonPrimary>
                Empezar por $47 <ArrowRight size={18} />
              </ButtonPrimary>
              <div className="text-sm text-gray-500 font-medium">Pago único. Sin suscripciones.</div>
            </div>

            <div className="flex items-center gap-6 text-sm text-gray-400 font-medium">
              <span className="flex items-center gap-2"><Check size={16} className="text-[#4F6EF7]" /> Guión listo en minutos</span>
              <span className="flex items-center gap-2"><Check size={16} className="text-[#4F6EF7]" /> Video sin grabarte</span>
            </div>
          </div>

          {/* Visual Side */}
          <div className="relative h-[600px] flex justify-center items-center reveal-up stagger-1">
            {/* Main Phone Mockup */}
            <div className="relative z-20 w-[280px] h-[580px] rounded-[2.5rem] border-[6px] border-[#1a1a1a] bg-black overflow-hidden shadow-2xl glow-blue transform rotate-2">
              <img 
                src={`${BASE_IMG}/hero-avatar.jpg`} 
                alt="AI Avatar Reel" 
                className="w-full h-full object-cover opacity-90"
              />
              
              {/* Fake UI Overlay on Phone */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6 pt-20">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4F6EF7] to-[#9B5CF6] p-[2px]">
                    <div className="w-full h-full rounded-full bg-black"></div>
                  </div>
                  <span className="text-white text-sm font-semibold">@tu_marca</span>
                </div>
                <p className="text-white/90 text-xs mb-4">El secreto para publicar todos los días sin volverte loco... 🚀</p>
                <div className="flex items-center justify-between text-white/80">
                  <span className="text-xs font-semibold bg-white/20 px-2 py-1 rounded backdrop-blur-sm">Edición IA</span>
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm"><span className="text-[10px]">❤️</span></div>
                    <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm"><span className="text-[10px]">💬</span></div>
                  </div>
                </div>
              </div>

              {/* Progress bar fake */}
              <div className="absolute top-0 inset-x-0 h-1 bg-white/20">
                <div className="h-full bg-white/80 w-1/3"></div>
              </div>
            </div>

            {/* Floating Elements */}
            <FloatingPill 
              icon={<Calendar size={16} />} 
              text="✦ 23 Reels / mes" 
              className="-left-12 top-20 z-30 transform -rotate-3 hidden md:flex"
            />
            <FloatingPill 
              icon={<Bot size={16} />} 
              text="100% automático" 
              className="-right-8 top-40 z-30 transform rotate-6 hidden md:flex"
            />
            <FloatingPill 
              icon={<Video size={16} />} 
              text="Avatar activo" 
              className="-left-6 bottom-40 z-30 transform rotate-2 hidden md:flex"
            />
            <FloatingPill 
              icon={<Instagram size={16} />} 
              text="Publicado en Instagram" 
              className="-right-12 bottom-24 z-30 transform -rotate-3 hidden md:flex"
            />

            {/* Background elements to add depth */}
            <div className="absolute -right-10 -top-10 w-64 h-64 bg-[#4F6EF7]/10 rounded-full blur-3xl z-0"></div>
            <div className="absolute -left-10 -bottom-10 w-64 h-64 bg-[#9B5CF6]/10 rounded-full blur-3xl z-0"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

const ProblemBeforeAfterSection = () => {
  return (
    <section className="py-32 relative border-t border-white/5 bg-[#0b0b0b]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 reveal-up">
          <div className="inline-block text-[#9B5CF6] text-sm font-bold tracking-widest uppercase mb-3">El Problema</div>
          <h2 className="font-display font-bold text-4xl lg:text-5xl text-white mb-6">
            Tienes el avatar. Te falta el sistema.
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            El avatar es solo una herramienta. Sin un sistema detrás, sigue dependiendo
            de tu tiempo, tu energía y tu disciplina para publicar con consistencia.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-stretch reveal-up stagger-1">
          {/* BEFORE: Chaos */}
          <div className="bg-[#111] border border-red-500/10 rounded-3xl p-8 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
              <X size={120} className="text-red-500" />
            </div>
            <div className="inline-block bg-red-500/10 text-red-500 font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wider mb-6">
              Sin Reelsona (Caos)
            </div>
            <h3 className="font-display text-2xl font-bold text-white mb-6">Producción Manual</h3>
            
            <div className="space-y-4 relative z-10">
              {[
                { i: Clock, t: "Horas pensando ideas frente a la pantalla en blanco" },
                { i: FilePen, t: "Escribiendo guiones que no enganchan" },
                { i: Video, t: "Grabando, repitiendo tomas, editando cortes" },
                { i: Settings2, t: "Sufriendo con CapCut para poner captions dinámicos" },
              ].map((item, idx) => (
                <div key={idx} className="flex gap-4 items-start bg-black/40 p-4 rounded-xl border border-white/5">
                  <div className="mt-1 text-red-400/70"><item.i size={20} /></div>
                  <div className="text-gray-400 text-sm leading-relaxed">{item.t}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AFTER: Autopilot */}
          <div className="bg-[#111] border border-[#4F6EF7]/30 rounded-3xl p-8 relative overflow-hidden glow-blue">
            <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-[#4F6EF7]/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="inline-block bg-[#4F6EF7]/20 text-[#4F6EF7] font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wider mb-6">
              Con Reelsona (Sistema)
            </div>
            <h3 className="font-display text-2xl font-bold text-white mb-6">Máquina en Autopilot</h3>
            
            <div className="space-y-4 relative z-10">
               {/* Visual nodes representing the smooth flow */}
               <div className="flex flex-col gap-2 relative">
                  <div className="absolute left-[19px] top-6 bottom-6 w-0.5 bg-gradient-to-b from-[#4F6EF7]/50 to-[#9B5CF6]/50"></div>
                  
                  {[
                    { i: Brain, t: "Estrategia de 30 días generada", active: true },
                    { i: Bot, t: "IA escribe guiones optimizados", active: true },
                    { i: Play, t: "Avatar graba en HeyGen", active: true },
                    { i: Instagram, t: "Publicado con captions", active: true },
                  ].map((item, idx) => (
                    <div key={idx} className="flex gap-4 items-center bg-gradient-to-r from-[#4F6EF7]/10 to-transparent p-4 rounded-xl border border-[#4F6EF7]/20">
                      <div className="w-10 h-10 rounded-full bg-[#4F6EF7] text-white flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(79,110,247,0.5)] z-10">
                        <item.i size={18} />
                      </div>
                      <div className="text-white font-medium text-sm">{item.t}</div>
                      <div className="ml-auto"><Check size={16} className="text-[#4F6EF7]" /></div>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const WhatIsSection = () => {
  return (
    <section className="py-32 relative bg-black overflow-hidden">
      {/* Decorative gradient mesh */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#4F6EF7]/50 to-transparent"></div>
      <div className="absolute left-1/2 top-0 -translate-x-1/2 w-full max-w-4xl h-[400px] bg-[#4F6EF7]/5 blur-[120px] rounded-[100%] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center mb-20 reveal-up">
          <h2 className="font-display font-bold text-4xl lg:text-5xl text-white mb-8 leading-tight">
            "HeyGen crea el video.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4F6EF7] to-[#9B5CF6]">
              Reelsona crea el sistema.
            </span>"
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            No es un editor de video más. Es tu sala de control. Tú defines la estrategia; 
            el sistema produce, edita y publica por ti.
          </p>
        </div>

        {/* FAKE PRODUCT UI PANEL */}
        <div className="mt-16 reveal-up stagger-1 mx-auto max-w-5xl">
          <div className="rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl overflow-hidden backdrop-blur-xl">
            {/* Window header */}
            <div className="bg-[#161616] border-b border-white/5 px-4 py-3 flex items-center gap-4">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-white/10"></div>
                <div className="w-3 h-3 rounded-full bg-white/10"></div>
                <div className="w-3 h-3 rounded-full bg-white/10"></div>
              </div>
              <div className="flex gap-4 text-xs font-medium text-gray-500 overflow-x-auto">
                <div className="text-white px-3 py-1 bg-white/5 rounded-md whitespace-nowrap">Content Pipeline</div>
                <div className="px-3 py-1 whitespace-nowrap">Script Editor</div>
                <div className="px-3 py-1 whitespace-nowrap">HeyGen Config</div>
              </div>
            </div>

            {/* Dashboard Content */}
            <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left sidebar / Pipeline */}
              <div className="col-span-1 space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-white font-bold font-display text-lg">Próximos Reels</h4>
                  <span className="bg-[#4F6EF7]/20 text-[#4F6EF7] text-[10px] px-2 py-0.5 rounded font-bold">AUTOPILOT ON</span>
                </div>
                
                {[
                  { title: "3 Mitos del Coaching", status: "Publicado", color: "text-green-400", bg: "bg-green-400/10" },
                  { title: "Cómo escalar a $10k", status: "Renderizando", color: "text-yellow-400", bg: "bg-yellow-400/10" },
                  { title: "Error en tu oferta", status: "Guión listo", color: "text-blue-400", bg: "bg-blue-400/10" },
                  { title: "Sistema de ventas", status: "Idea", color: "text-gray-400", bg: "bg-gray-400/10" },
                ].map((item, i) => (
                  <div key={i} className="bg-[#1a1a1a] p-3 rounded-lg border border-white/5">
                    <div className="text-sm text-white font-medium mb-2 truncate">{item.title}</div>
                    <div className={`text-xs inline-block px-2 py-1 rounded ${item.bg} ${item.color}`}>
                      {item.status}
                    </div>
                  </div>
                ))}
              </div>

              {/* Main Content Area / Editor Preview */}
              <div className="col-span-1 lg:col-span-2 bg-[#161616] rounded-xl border border-white/5 p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#9B5CF6]/10 blur-2xl"></div>
                
                <div className="flex flex-col sm:flex-row justify-between items-start mb-6 relative z-10 gap-4">
                  <div>
                    <h3 className="text-2xl font-bold font-display text-white mb-2">Cómo escalar a $10k</h3>
                    <p className="text-xs text-gray-500">Hook: "Si sigues cobrando por hora, nunca vas a llegar a $10k..."</p>
                  </div>
                  <button className="bg-[#4F6EF7] text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2 shrink-0">
                    <Play size={12} fill="currentColor" /> Generar Video
                  </button>
                </div>

                {/* Script Editor Fake */}
                <div className="space-y-3 relative z-10">
                  <div className="bg-black/50 border border-white/5 p-4 rounded-lg font-mono text-sm text-gray-400 leading-relaxed overflow-x-auto">
                    <span className="text-[#9B5CF6] font-bold">[Hook]</span> Si sigues cobrando por hora, nunca vas a llegar a $10k al mes. Te explico por qué.<br/><br/>
                    <span className="text-[#4F6EF7] font-bold">[Cuerpo]</span> El problema es que tu tiempo tiene un límite. Solo puedes trabajar 8 o 10 horas al día. Para escalar, necesitas empaquetar tu conocimiento en una oferta high-ticket.<br/><br/>
                    <span className="text-green-500 font-bold">[CTA]</span> Comenta 'ESCALAR' y te envío mi sistema exacto por DM.
                  </div>
                </div>

                {/* Status Bar */}
                <div className="mt-6 flex flex-wrap gap-4 items-center border-t border-white/10 pt-4 relative z-10">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Bot size={14} className="text-[#4F6EF7]" /> Avatar: <span className="text-white">Studio Alpha</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Settings2 size={14} className="text-[#9B5CF6]" /> Estilo: <span className="text-white">Hormozi Style</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const AutopilotPipelineSection = () => {
  return (
    <section className="py-32 relative bg-[#0b0b0b]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-20 reveal-up">
          <div className="inline-flex items-center gap-2 rounded-full text-xs font-bold tracking-widest uppercase mb-4 px-4 py-1.5 bg-[#9B5CF6]/10 border border-[#9B5CF6]/20 text-[#9B5CF6]">
            <Rocket size={14} /> Modo Autopilot
          </div>
          <h2 className="font-display font-bold text-4xl lg:text-5xl text-white mb-6">
            Conecta los cables. Déjalo correr.
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            Configura tu estrategia, conecta tus herramientas y deja que tu clon digital trabaje por ti.
            El sistema ejecuta el pipeline completo sin intervención manual.
          </p>
        </div>

        {/* VISUAL PIPELINE - Desktop */}
        <div className="relative py-12 reveal-up stagger-1 hidden lg:block">
          {/* Connecting line */}
          <div className="absolute top-1/2 left-0 w-full h-1 bg-[#1a1a1a] -translate-y-1/2 z-0"></div>
          {/* Animated progress line */}
          <div className="absolute top-1/2 left-0 w-[80%] h-1 bg-gradient-to-r from-[#4F6EF7] to-[#9B5CF6] -translate-y-1/2 z-0 opacity-80" 
               style={{ animation: 'pulse 2s infinite alternate' }}></div>

          <div className="grid grid-cols-5 gap-4 relative z-10">
            {[
              { icon: Target, title: "Estrategia", desc: "Nicho & Ángulos", color: "#4F6EF7" },
              { icon: FilePen, title: "Guión IA", desc: "Hooks & Retención", color: "#6366f1" },
              { icon: Bot, title: "Avatar", desc: "HeyGen Render", color: "#8b5cf6" },
              { icon: Sparkles, title: "Captions", desc: "Estilo Visual", color: "#a855f7" },
              { icon: Instagram, title: "Instagram", desc: "Publicación Automática", color: "#d946ef" },
            ].map((node, i) => (
              <div key={i} className="flex flex-col items-center group relative">
                <div className="w-16 h-16 rounded-2xl bg-[#111] border-2 flex items-center justify-center mb-4 transition-transform group-hover:scale-110 shadow-xl"
                     style={{ borderColor: node.color, boxShadow: `0 0 20px ${node.color}40` }}>
                  <node.icon size={24} color={node.color} />
                </div>
                <h4 className="text-white font-bold font-display mb-1 text-center">{node.title}</h4>
                <p className="text-gray-500 text-xs text-center">{node.desc}</p>
                
                {/* Flow indicator */}
                {i < 4 && (
                   <div className="absolute top-8 -right-[30px] translate-x-1/2 -translate-y-1/2 text-[#4F6EF7] node-pulse">
                     <ArrowRight size={20} />
                   </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mobile Pipeline Fallback */}
        <div className="lg:hidden space-y-6 relative reveal-up stagger-1 pl-4">
          <div className="absolute left-12 top-8 bottom-8 w-1 bg-gradient-to-b from-[#4F6EF7] to-[#9B5CF6]"></div>
          {[
              { icon: Target, title: "Estrategia", desc: "Nicho & Ángulos" },
              { icon: FilePen, title: "Guión IA", desc: "Hooks & Retención" },
              { icon: Bot, title: "Avatar", desc: "HeyGen Render" },
              { icon: Sparkles, title: "Captions", desc: "Estilo Visual" },
              { icon: Instagram, title: "Instagram", desc: "Publicación Automática" },
          ].map((node, i) => (
            <div key={i} className="flex gap-6 items-center relative z-10">
              <div className="w-16 h-16 rounded-2xl bg-[#111] border-2 border-[#4F6EF7] flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(79,110,247,0.3)]">
                <node.icon size={24} className="text-[#4F6EF7]" />
              </div>
              <div>
                <h4 className="text-white font-bold font-display text-lg">{node.title}</h4>
                <p className="text-gray-400 text-sm">{node.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const LifestyleSection = () => {
  return (
    <section className="py-24 relative overflow-hidden bg-black">
      <div className="max-w-7xl mx-auto px-6">
        <div className="rounded-[2.5rem] bg-[#111] border border-white/5 overflow-hidden relative reveal-up">
          <div className="absolute inset-0">
             <img 
               src={`${BASE_IMG}/relaxed-creator.jpg`} 
               alt="Creator relaxing while system works" 
               className="w-full h-full object-cover opacity-40 mix-blend-luminosity"
             />
             <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent"></div>
          </div>
          
          <div className="relative z-10 p-8 md:p-20 max-w-2xl">
            <h2 className="font-display font-bold text-3xl md:text-5xl text-white mb-6 leading-tight">
              Mientras tú vives, <br/>tu avatar publica.
            </h2>
            <p className="text-gray-300 text-lg mb-8 leading-relaxed">
              No pagas por producir un video. Pagas por montar una máquina que te devuelve el tiempo mientras tu marca personal sigue creciendo.
            </p>
            <ButtonPrimary>Quiero mi máquina por $47</ButtonPrimary>
          </div>
        </div>
      </div>
    </section>
  )
}

const CostComparisonSection = () => {
  return (
    <section className="py-32 relative bg-[#090909]">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16 reveal-up">
          <h2 className="font-display font-bold text-4xl lg:text-5xl text-white mb-6">
            Cuánto cuesta la consistencia
          </h2>
          <p className="text-gray-400 text-lg">La producción tradicional de Reels es un agujero negro de presupuesto y tiempo.</p>
        </div>

        <div className="bg-[#111] border border-white/10 rounded-3xl p-6 md:p-12 reveal-up stagger-1">
          <div className="space-y-6">
            
            {/* Competitor Bars */}
            {[
              { label: "Agencia de Producción", cost: "$2,000 - $5,000 / mes", width: "w-full", bg: "bg-[#222]" },
              { label: "Videógrafo + Editor", cost: "$800 - $1,500 / mes", width: "w-[80%] md:w-[60%]", bg: "bg-[#2a2a2a]" },
              { label: "Edición por Reel ($50 c/u x 20)", cost: "$1,000 / mes", width: "w-[60%] md:w-[45%]", bg: "bg-[#333]" },
            ].map((bar, i) => (
              <div key={i} className="relative">
                <div className="flex flex-col md:flex-row md:justify-between text-sm text-gray-400 mb-2 font-medium gap-1">
                  <span>{bar.label}</span>
                  <span className="text-white/80">{bar.cost}</span>
                </div>
                <div className="h-4 bg-[#0a0a0a] rounded-full overflow-hidden">
                  <div className={`h-full ${bar.bg} ${bar.width} rounded-full`}></div>
                </div>
              </div>
            ))}

            <div className="h-px bg-white/10 my-8"></div>

            {/* Reelsona Bar */}
            <div className="relative p-6 rounded-2xl bg-gradient-to-r from-[#4F6EF7]/10 to-[#9B5CF6]/10 border border-[#4F6EF7]/30 glow-blue">
              <div className="flex flex-col md:flex-row md:justify-between text-lg md:text-xl text-white mb-4 font-bold font-display gap-2">
                <span className="flex items-center gap-2"><Sparkles className="text-[#4F6EF7]" /> Reelsona Sistema Completo</span>
                <span className="text-[#4F6EF7]">$47 pago único</span>
              </div>
              <div className="h-4 bg-[#0a0a0a] rounded-full overflow-hidden">
                <div className="h-full w-[15%] md:w-[5%] bg-gradient-to-r from-[#4F6EF7] to-[#9B5CF6] rounded-full shadow-[0_0_10px_#4F6EF7]"></div>
              </div>
              <p className="text-sm text-gray-400 mt-4 leading-relaxed">
                *Requiere cuentas independientes de HeyGen y OpenAI según tu volumen de producción.
              </p>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
};

const CTASection = () => {
  return (
    <section className="py-32 relative overflow-hidden bg-black border-t border-white/5">
      <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full pointer-events-none bg-gradient-to-b from-[#4F6EF7]/10 to-[#9B5CF6]/10 blur-[100px]" />

      <div className="max-w-4xl mx-auto px-6 text-center relative z-10 reveal-up">
        <h2 className="font-display font-bold text-5xl lg:text-7xl text-white mb-6 leading-tight">
          Tu clon digital te está esperando.
        </h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          Accede hoy a Reelsona por un pago único de $47 y monta la máquina que te liberará de la producción manual para siempre.
        </p>
        
        <ButtonPrimary className="text-lg px-8 py-4 mb-6">
          Obtener Reelsona por $47
        </ButtonPrimary>
        
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-6 text-sm text-gray-500 font-medium">
          <span className="flex items-center gap-1.5"><Check size={16} className="text-[#4F6EF7]"/> Acceso de por vida</span>
          <span className="flex items-center gap-1.5"><Check size={16} className="text-[#4F6EF7]"/> Sin mensualidades</span>
        </div>
      </div>
    </section>
  );
};

// --- Main Wrapper ---

export default function LandingVisual() {
  useRevealObserver();

  return (
    <>
      <style>{fontStyles}</style>
      <div className="min-h-screen bg-[#090909] text-gray-100 selection:bg-[#4F6EF7]/30 selection:text-white">
        {/* Navigation Mock */}
        <nav className="fixed top-0 inset-x-0 h-20 z-50 bg-[#090909]/80 backdrop-blur-xl border-b border-white/5 px-6 flex items-center justify-between">
          <div className="font-display font-bold text-xl tracking-tight flex items-center gap-2 text-white">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#4F6EF7] to-[#9B5CF6] flex items-center justify-center">
              <span className="text-[10px] text-white">R</span>
            </div>
            Reelsona
          </div>
          <ButtonPrimary className="!py-2 !px-4 !text-sm">Empezar $47</ButtonPrimary>
        </nav>

        <main>
          <HeroSection />
          <ProblemBeforeAfterSection />
          <WhatIsSection />
          <AutopilotPipelineSection />
          <LifestyleSection />
          <CostComparisonSection />
          <CTASection />
        </main>
        
        <footer className="py-12 border-t border-white/5 text-center text-gray-600 text-sm bg-black">
           <p>© {new Date().getFullYear()} Reelsona. Todos los derechos reservados.</p>
        </footer>
      </div>
    </>
  );
}
