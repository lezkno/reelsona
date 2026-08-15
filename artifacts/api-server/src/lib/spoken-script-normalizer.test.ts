/**
 * Unit tests — Spoken Script Normalizer
 *
 * Covers normalizeToSpokenScript(), validateSpokenScript(), and prepareForTts().
 * No I/O, no network — pure logic only.
 *
 * Run with:
 *   node --import tsx/esm --test src/lib/spoken-script-normalizer.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeToSpokenScript,
  validateSpokenScript,
  prepareForTts,
} from "./spoken-script-normalizer.js";

// ── normalizeToSpokenScript ────────────────────────────────────────────────────

describe("normalizeToSpokenScript", () => {

  // ── URLs ───────────────────────────────────────────────────────────────────
  describe("URLs", () => {
    test("replaces https:// URL with 'enlace'", () => {
      assert.equal(
        normalizeToSpokenScript("Visita https://ejemplo.com para más info."),
        "Visita enlace para más info.",
      );
    });

    test("replaces http:// URL with 'enlace'", () => {
      assert.equal(
        normalizeToSpokenScript("Ir a http://sitio.org ahora."),
        "Ir a enlace ahora.",
      );
    });

    test("replaces www. URL with 'enlace'", () => {
      assert.equal(
        normalizeToSpokenScript("Entra a www.miempresa.com hoy."),
        "Entra a enlace hoy.",
      );
    });
  });

  // ── Hashtags ───────────────────────────────────────────────────────────────
  describe("hashtags", () => {
    test("removes single hashtag", () => {
      const result = normalizeToSpokenScript("Aprende marketing. #marketing");
      assert.ok(!result.includes("#"), "hashtag should be removed");
      assert.ok(result.includes("Aprende marketing."), "main text preserved");
    });

    test("removes multiple hashtags", () => {
      const result = normalizeToSpokenScript("Contenido #viral #emprendimiento #exito");
      assert.ok(!result.includes("#"), "all hashtags should be removed");
      assert.ok(result.includes("Contenido"), "main text preserved");
    });

    test("removes hashtag inline with accented characters", () => {
      const result = normalizeToSpokenScript("El #éxito depende de ti.");
      assert.ok(!result.includes("#éxito"), "accented hashtag removed");
      assert.ok(!result.includes("#"), "no # symbol left");
    });
  });

  // ── @handles ──────────────────────────────────────────────────────────────
  describe("@handles", () => {
    test("removes @handle", () => {
      const result = normalizeToSpokenScript("Sígueme en @miusuario para más.");
      assert.ok(!result.includes("@miusuario"), "@handle removed");
      assert.ok(result.includes("Sígueme en"), "text before handle preserved");
    });

    test("removes @handle with dots", () => {
      const result = normalizeToSpokenScript("Contacta a @nombre.apellido hoy.");
      assert.ok(!result.includes("@"), "@handle removed");
    });
  });

  // ── Percentages ───────────────────────────────────────────────────────────
  describe("percentages", () => {
    test("converts integer percentage", () => {
      assert.equal(
        normalizeToSpokenScript("El 90% de los emprendedores falla."),
        "El 90 por ciento de los emprendedores falla.",
      );
    });

    test("converts decimal percentage with period", () => {
      assert.ok(
        normalizeToSpokenScript("Solo el 4.5% lo logra.").includes("4.5 por ciento"),
      );
    });

    test("converts decimal percentage with comma", () => {
      assert.ok(
        normalizeToSpokenScript("Solo el 4,5% lo logra.").includes("4,5 por ciento"),
      );
    });

    test("converts percentage without space before symbol", () => {
      assert.ok(
        normalizeToSpokenScript("Tasa del 30%").includes("30 por ciento"),
      );
    });
  });

  // ── Currency ──────────────────────────────────────────────────────────────
  describe("currency", () => {
    test("converts dollar amount", () => {
      assert.equal(
        normalizeToSpokenScript("Gana $200 al mes."),
        "Gana 200 dólares al mes.",
      );
    });

    test("converts dollar amount with comma separator", () => {
      assert.ok(
        normalizeToSpokenScript("Facturas de $10,000 al año.").includes("10000 dólares"),
      );
    });

    test("converts euro amount", () => {
      assert.equal(
        normalizeToSpokenScript("Cuesta €150 al mes."),
        "Cuesta 150 euros al mes.",
      );
    });

    test("converts dollar amount with decimal (drops cents)", () => {
      assert.ok(
        normalizeToSpokenScript("Por solo $9.99 al mes.").includes("9 dólares"),
      );
    });
  });

  // ── Acronyms ──────────────────────────────────────────────────────────────
  describe("acronyms", () => {
    test("expands IA to inteligencia artificial", () => {
      assert.ok(
        normalizeToSpokenScript("La IA está cambiando todo.").includes("inteligencia artificial"),
      );
    });

    test("expands AI to inteligencia artificial", () => {
      assert.ok(
        normalizeToSpokenScript("El AI mejora tu negocio.").includes("inteligencia artificial"),
      );
    });

    test("expands 24/7", () => {
      assert.ok(
        normalizeToSpokenScript("Disponible 24/7 para ti.").includes("veinticuatro horas"),
      );
    });

    test("expands ROI", () => {
      assert.ok(
        normalizeToSpokenScript("Mejora tu ROI rápido.").includes("retorno de inversión"),
      );
    });

    test("expands KPI", () => {
      assert.ok(
        normalizeToSpokenScript("Tus KPI son clave.").includes("indicadores clave"),
      );
    });

    test("expands CEO", () => {
      assert.ok(
        normalizeToSpokenScript("El CEO de la empresa.").includes("director ejecutivo"),
      );
    });

    test("does not expand lowercase 'ai' (false positive guard)", () => {
      // "AI" as whole word only — "railway", "plain" should not match
      const result = normalizeToSpokenScript("El tren sale del rail.");
      assert.ok(!result.includes("inteligencia artificial"), "no false positive on 'rail'");
    });
  });

  // ── Emojis ────────────────────────────────────────────────────────────────
  describe("emojis", () => {
    test("removes face emoji", () => {
      const result = normalizeToSpokenScript("Hola! 😀 Esto es increíble.");
      assert.ok(!result.includes("😀"), "face emoji removed");
      assert.ok(result.includes("Hola!"), "text preserved");
    });

    test("removes multiple emojis", () => {
      const result = normalizeToSpokenScript("🚀 Lanza tu negocio 💰 hoy mismo 🔥");
      assert.ok(!/\p{Extended_Pictographic}/u.test(result), "all emojis removed");
    });

    test("removes emoji at start of string", () => {
      const result = normalizeToSpokenScript("🎯 El objetivo es claro.");
      assert.ok(!result.startsWith("🎯"), "leading emoji removed");
      assert.ok(result.includes("El objetivo"), "text preserved");
    });

    test("text without emojis is unchanged", () => {
      const input = "El objetivo es claro y directo.";
      assert.equal(normalizeToSpokenScript(input), input);
    });
  });

  // ── Markdown ──────────────────────────────────────────────────────────────
  describe("markdown", () => {
    test("strips **bold** markers, keeps text", () => {
      assert.equal(
        normalizeToSpokenScript("Este es un punto **muy importante**."),
        "Este es un punto muy importante.",
      );
    });

    test("strips *italic* markers, keeps text", () => {
      assert.equal(
        normalizeToSpokenScript("Esto es *clave* para ti."),
        "Esto es clave para ti.",
      );
    });

    test("strips __bold__ markers", () => {
      assert.equal(
        normalizeToSpokenScript("Texto __resaltado__ aquí."),
        "Texto resaltado aquí.",
      );
    });

    test("strips `code` backticks", () => {
      assert.equal(
        normalizeToSpokenScript("Usa el comando `start` ahora."),
        "Usa el comando start ahora.",
      );
    });

    test("strips # heading markers", () => {
      const result = normalizeToSpokenScript("# Introducción\nEsto es el cuerpo.");
      assert.ok(!result.includes("# "), "heading marker removed");
      assert.ok(result.includes("Introducción"), "heading text preserved");
    });

    test("strips ## heading markers", () => {
      const result = normalizeToSpokenScript("## Sección dos");
      assert.ok(!result.includes("##"), "heading marker removed");
    });
  });

  // ── Bullets / lists ───────────────────────────────────────────────────────
  describe("bullet and numbered lists", () => {
    test("removes dash bullet markers", () => {
      const input = "- Primero haz esto\n- Luego aquello\n- Finalmente";
      const result = normalizeToSpokenScript(input);
      assert.ok(!result.includes("- "), "bullet markers removed");
      assert.ok(result.includes("Primero haz esto"), "text preserved");
    });

    test("removes asterisk bullet markers", () => {
      const result = normalizeToSpokenScript("* Punto uno\n* Punto dos");
      assert.ok(!result.match(/^\* /m), "asterisk bullets removed");
    });

    test("removes numbered list markers (1. style)", () => {
      const result = normalizeToSpokenScript("1. Primero\n2. Segundo\n3. Tercero");
      assert.ok(!result.match(/\d\./), "numbered list markers removed");
      assert.ok(result.includes("Primero"), "text preserved");
    });

    test("removes numbered list markers (1) style)", () => {
      const result = normalizeToSpokenScript("1) Paso uno\n2) Paso dos");
      assert.ok(!result.match(/\d\)/), "numbered list markers removed");
    });
  });

  // ── Punctuation → pauses ──────────────────────────────────────────────────
  describe("punctuation to spoken pauses", () => {
    test("replaces em dash with comma pause", () => {
      const result = normalizeToSpokenScript("El problema — la solución está aquí.");
      assert.ok(!result.includes("—"), "em dash removed");
      assert.ok(result.includes(","), "comma pause inserted");
    });

    test("replaces en dash with comma pause", () => {
      const result = normalizeToSpokenScript("Lunes – viernes trabaja duro.");
      assert.ok(!result.includes("–"), "en dash removed");
    });

    test("replaces ellipsis (...) with period", () => {
      const result = normalizeToSpokenScript("Y entonces... todo cambió.");
      assert.ok(!result.includes("..."), "ellipsis removed");
    });

    test("replaces unicode ellipsis (…) with period", () => {
      const result = normalizeToSpokenScript("Imagina… que puedes lograrlo.");
      assert.ok(!result.includes("…"), "unicode ellipsis removed");
    });

    test("replaces semicolon with period", () => {
      const result = normalizeToSpokenScript("Trabaja duro; los resultados llegarán.");
      assert.ok(!result.includes(";"), "semicolon removed");
    });

    test("replaces non-time colon with comma", () => {
      const result = normalizeToSpokenScript("Recuerda: el esfuerzo vale la pena.");
      assert.ok(!result.includes(":"), "colon removed");
      assert.ok(result.includes(","), "comma inserted");
    });

    test("preserves time colon (10:30)", () => {
      const result = normalizeToSpokenScript("La reunión es a las 10:30.");
      assert.ok(result.includes("10:30"), "time colon preserved");
    });
  });

  // ── Whitespace ────────────────────────────────────────────────────────────
  describe("whitespace normalization", () => {
    test("collapses multiple spaces", () => {
      const result = normalizeToSpokenScript("Texto   con    espacios.");
      assert.ok(!result.includes("  "), "multiple spaces collapsed");
    });

    test("converts newlines to spaces", () => {
      const result = normalizeToSpokenScript("Primera línea.\nSegunda línea.");
      assert.ok(!result.includes("\n"), "newline removed");
      assert.ok(result.includes("Primera línea."), "text preserved");
    });

    test("trims leading and trailing whitespace", () => {
      const result = normalizeToSpokenScript("   Texto con espacios.   ");
      assert.equal(result[0], "T", "leading whitespace trimmed");
      assert.equal(result[result.length - 1], ".", "trailing whitespace trimmed");
    });
  });

  // ── Mixed / integration ───────────────────────────────────────────────────
  describe("mixed / integration", () => {
    test("full social media post → clean spoken script", () => {
      const input = [
        "🚀 **Transforma tu negocio con IA** 🔥",
        "",
        "El 90% de los emprendedores fracasan porque no usan la IA correctamente.",
        "",
        "Aquí los 3 pasos:",
        "1. Automatiza tus KPI",
        "2. Mejora tu ROI con $0 de inversión inicial",
        "3. Usa el CEO mindset",
        "",
        "Inscríbete en https://curso.com hoy mismo.",
        "#emprendimiento #IA #CEO @micuenta",
      ].join("\n");

      const result = normalizeToSpokenScript(input);

      assert.ok(!result.includes("🚀"),                  "rocket emoji removed");
      assert.ok(!result.includes("🔥"),                  "fire emoji removed");
      assert.ok(!result.includes("**"),                   "markdown bold removed");
      assert.ok(!result.includes("#emprendimiento"),      "hashtag removed");
      assert.ok(!result.includes("@micuenta"),            "@handle removed");
      assert.ok(!result.includes("https://"),             "URL removed");
      assert.ok(!result.includes("KPI"),                  "KPI expanded");
      assert.ok(!result.includes("ROI"),                  "ROI expanded");
      assert.ok(!result.includes("CEO"),                  "CEO expanded");
      assert.ok(result.includes("inteligencia artificial"), "IA expanded");
      assert.ok(result.includes("90 por ciento"),          "% converted");
      assert.ok(result.includes("0 dólares"),              "$ converted");
      assert.ok(!result.includes("\n"),                    "newlines removed");
    });

    test("clean spoken script passes through unchanged", () => {
      const input = "¿Sabías que puedes duplicar tus ingresos en tres meses? Hoy te explico cómo.";
      assert.equal(normalizeToSpokenScript(input), input);
    });

    test("script with only emojis and hashtags returns empty or whitespace-only", () => {
      const result = normalizeToSpokenScript("🎉🎊 #fiesta #celebración");
      assert.equal(result.trim(), "", "result should be empty after removing everything");
    });
  });
});

// ── validateSpokenScript ──────────────────────────────────────────────────────

describe("validateSpokenScript", () => {
  test("returns empty array for clean script", () => {
    const issues = validateSpokenScript("El éxito llega con esfuerzo y constancia.");
    assert.deepEqual(issues, []);
  });

  test("detects hashtag", () => {
    assert.ok(validateSpokenScript("Texto #marketing aquí.").includes("hashtag"));
  });

  test("detects @handle", () => {
    assert.ok(validateSpokenScript("Sígueme @usuario por favor.").includes("@handle"));
  });

  test("detects emoji", () => {
    assert.ok(validateSpokenScript("Hola 😊 mundo.").includes("emoji"));
  });

  test("detects URL", () => {
    assert.ok(validateSpokenScript("Visita https://web.com ahora.").includes("URL"));
  });

  test("detects markdown", () => {
    assert.ok(validateSpokenScript("Esto es **importante**.").includes("markdown"));
  });

  test("detects backtick", () => {
    assert.ok(validateSpokenScript("Usa `código` aquí.").includes("backtick"));
  });

  test("detects bullet list", () => {
    assert.ok(validateSpokenScript("- Item uno\n- Item dos").includes("bullet-list"));
  });

  test("detects numbered list", () => {
    assert.ok(validateSpokenScript("1. Primero\n2. Segundo").includes("numbered-list"));
  });

  test("detects multiple issues simultaneously", () => {
    const issues = validateSpokenScript("🎯 **Texto** con #hashtag y @usuario.");
    assert.ok(issues.includes("emoji"),    "emoji detected");
    assert.ok(issues.includes("markdown"), "markdown detected");
    assert.ok(issues.includes("hashtag"),  "hashtag detected");
    assert.ok(issues.includes("@handle"),  "@handle detected");
  });
});

// ── prepareForTts ─────────────────────────────────────────────────────────────

describe("prepareForTts", () => {
  test("returns spokenScript, issues, and wasClean", () => {
    const result = prepareForTts("Texto limpio y directo.");
    assert.ok("spokenScript" in result, "has spokenScript");
    assert.ok("issues" in result,       "has issues");
    assert.ok("wasClean" in result,     "has wasClean");
  });

  test("wasClean is true for already-clean script", () => {
    const result = prepareForTts("Aprende a crecer tu negocio hoy mismo.");
    assert.equal(result.wasClean, true);
  });

  test("wasClean is false when script had issues", () => {
    const result = prepareForTts("El 90% de emprendedores usa IA 🚀 #exito");
    assert.equal(result.wasClean, false);
  });

  test("spokenScript is clean even when original had issues", () => {
    const { spokenScript } = prepareForTts("Usa IA 🔥 y crece al 100%");
    assert.ok(!/\p{Extended_Pictographic}/u.test(spokenScript), "no emoji in spokenScript");
    assert.ok(spokenScript.includes("inteligencia artificial"), "IA expanded");
    assert.ok(spokenScript.includes("100 por ciento"), "% converted");
  });

  test("issues lists what was found in the original", () => {
    const { issues } = prepareForTts("Texto 😊 con #hashtag.");
    assert.ok(issues.includes("emoji"),   "emoji in issues");
    assert.ok(issues.includes("hashtag"), "hashtag in issues");
  });
});
