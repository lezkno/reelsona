import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSemanticContext,
  normalizeCreatorProfile,
  validateSemanticOutput,
} from "./semantic-context";

const reelsona = normalizeCreatorProfile({
  niche: "Avatar, marketing digital, automatizaciones, negocios digitales",
  nicheDescription: "Personas y dueños de negocios que quieren generar ventas en automático usando un avatar digital y automatizaciones, ahorrar tiempo y dinero y mantener presencia en Instagram.",
  topicKeywords: ["clon digital", "avatar", "chatbot", "inteligencia artificial", "dinero", "negocios digitales", "afiliados", "buscar clientes", "marca personal", "crear contenidos en automático"],
  offer: "Software que crea avatares realistas para crear reels en Instagram automáticamente sin producciones complejas ni conocimiento técnico.",
  idealAudience: "Personas y dueños de negocios que quieren generar ventas en automático.",
  uniqueValueProp: "Crear reels con un avatar y automatización sin producciones complejas ni conocimiento técnico.",
  voiceStyle: "Directo, sin rodeos, muy familiar.",
  tone: "Casual & Cercano",
  language: "es",
});

describe("commercial semantic context", () => {
  it("keeps offer, audience, mechanism, result and keywords in distinct roles", () => {
    const context = buildSemanticContext(reelsona);
    assert.match(context, /OFERTA \/ PRODUCTO QUE SE VENDE: Software que crea avatares/);
    assert.match(context, /AUDIENCIA A LA QUE SE HABLA: Personas y dueños de negocios/);
    assert.match(context, /MECANISMO \/ HERRAMIENTAS UTILIZADAS: clon digital, avatar, chatbot, inteligencia artificial/);
    assert.match(context, /PALABRAS CLAVE SECUNDARIAS:/);
    assert.match(context, /La OFERTA es el único producto/);
  });

  it("rejects selling an avatar or chatbot when the configured offer is different", () => {
    const result = validateSemanticOutput({
      topic: "Más vistas no significan más ventas",
      script: "Un Reel puede conseguir miles de vistas y aun así no vender ni un avatar. Si vendes automatizaciones, puedes usar un avatar y un chatbot para vender.",
      cta: "Sígueme para aprender más.",
    }, reelsona);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((reason) => reason.includes("avatar")));
    assert.ok(result.reasons.some((reason) => reason.includes("chatbot")));
  });

  it("accepts a specific script that positions the configured offer correctly", () => {
    const result = validateSemanticOutput({
      topic: "Tus reels pueden tener constancia aunque no tengas tiempo para grabar",
      script: "Si eres dueño de un negocio, el problema no es que te falten ideas, es que producir cada Reel te quita demasiado tiempo. Reelsona usa un avatar digital y automatizaciones para crear reels de Instagram sin una producción compleja. Así mantienes presencia y puedes concentrarte en atender a tus clientes. Sígueme para ver cómo crear contenido con Reelsona.",
      cta: "Sígueme para ver cómo crear contenido con Reelsona.",
    }, reelsona);
    assert.equal(result.valid, true);
  });

  it("does not treat a keyword as the product in another profile", () => {
    const profile = normalizeCreatorProfile({
      niche: "ventas B2B",
      topicKeywords: ["chatbot", "automatización", "CRM"],
      offer: "Consultoría de ventas B2B para equipos comerciales.",
      idealAudience: "Dueños de empresas B2B.",
    });
    const result = validateSemanticOutput({
      script: "Si vendes chatbots, esta herramienta te ayudará a cerrar más.",
      cta: "Agenda una consultoría de ventas B2B.",
    }, profile);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((reason) => reason.includes("chatbot")));
  });

  it("uses a service offer dynamically instead of assuming software", () => {
    const profile = normalizeCreatorProfile({
      niche: "nutrición para deportistas",
      topicKeywords: ["proteína", "plan de comidas", "automatización"],
      offer: "Servicio de asesoría nutricional personalizada para corredores.",
      idealAudience: "Corredores amateurs que quieren mejorar su alimentación.",
    });
    const context = buildSemanticContext(profile);
    assert.match(context, /OFERTA CONFIGURADA ES LA ÚNICA PROPUESTA/);
    assert.match(context, /Servicio de asesoría nutricional personalizada/);
    const result = validateSemanticOutput({
      script: "Si corres y no sabes cómo organizar tus comidas, mi servicio de asesoría nutricional personalizada adapta tu plan a tus entrenamientos.",
      cta: "Reserva tu asesoría nutricional personalizada.",
    }, profile);
    assert.equal(result.valid, true);
  });
});