import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ONESIGNAL_APP_ID = "f1d17c3e-a156-4a64-a288-c1a4f04f686d";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")!;

const HORAS_DISPONIBLE = 24; // a partir de acá puede volver a girar
const HORAS_AVISO_RACHA = 42; // 6hs antes de perder la racha
const HORAS_LIMITE_RACHA = 48; // a partir de acá la racha ya se perdió

async function enviarPush(externalId: string, title: string, message: string): Promise<boolean> {
  try {
    const resp = await fetch("https://api.onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        headings: { en: title, es: title },
        contents: { en: message, es: message },
        url: "https://nucky-corp.vercel.app",
        include_aliases: { external_id: [externalId] },
        target_channel: "push",
      }),
    });

    if (!resp.ok) {
      console.error("Error de OneSignal:", await resp.text());
    }
    return resp.ok;
  } catch (err) {
    console.error("Error enviando push:", err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // sin body o body vacío, no pasa nada
    }
    const dryRun = url.searchParams.get("dry_run") === "true" || body?.dry_run === true;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const ahoraMs = Date.now();
    const cutoff24h = new Date(ahoraMs - HORAS_DISPONIBLE * 3600 * 1000).toISOString();

    // Candidatos: cualquiera que ya haya cruzado el umbral de 24hs (cubre también
    // la ventana de "racha en riesgo", que es más tardía que la de "disponible").
    const { data: candidatos, error } = await supabaseAdmin
      .from("usuarios")
      .select(
        "id, username, subscriber_id, ultima_ruleta, racha_ruleta, notif_disponible_enviada_para, notif_racha_riesgo_enviada_para"
      )
      .not("ultima_ruleta", "is", null)
      .lte("ultima_ruleta", cutoff24h);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lista = candidatos || [];

    // Quiénes tienen un premio de ruleta pendiente: no les avisamos "ya podés
    // girar" si todavía no cobraron el anterior.
    const { data: pendientes } = await supabaseAdmin
      .from("premios_ruleta")
      .select("usuario, subscriber_id")
      .eq("estado", "pendiente")
      .eq("origen", "ruleta");

    const tienePendiente = new Set(
      (pendientes || []).map((p) => `${p.usuario}__${p.subscriber_id}`)
    );

    let disponibleEnviadas = 0;
    let rachaEnviadas = 0;
    const detalle: Record<string, unknown>[] = [];

    for (const u of lista) {
      const horasPasadas = (ahoraMs - new Date(u.ultima_ruleta).getTime()) / (1000 * 60 * 60);
      const clave = `${u.username}__${u.subscriber_id}`;
      const yaTienePendiente = tienePendiente.has(clave);

      const avisarDisponible =
        horasPasadas >= HORAS_DISPONIBLE &&
        u.notif_disponible_enviada_para !== u.ultima_ruleta &&
        !yaTienePendiente;

      const avisarRacha =
        horasPasadas >= HORAS_AVISO_RACHA &&
        horasPasadas < HORAS_LIMITE_RACHA &&
        (u.racha_ruleta || 0) > 0 &&
        u.notif_racha_riesgo_enviada_para !== u.ultima_ruleta;

      if (!avisarDisponible && !avisarRacha) continue;

      if (dryRun) {
        detalle.push({
          username: u.username,
          subscriber_id: u.subscriber_id,
          horas_pasadas: Math.round(horasPasadas * 10) / 10,
          racha_ruleta: u.racha_ruleta,
          tiene_pendiente: yaTienePendiente,
          avisaria_disponible: avisarDisponible,
          avisaria_racha: avisarRacha,
        });
        continue;
      }

      if (avisarDisponible) {
        const ok = await enviarPush(
          clave,
          "🎰 ¡Ya podés girar la ruleta!",
          "Tu ruleta gratis ya está disponible. ¡No te la pierdas!"
        );
        if (ok) {
          await supabaseAdmin
            .from("usuarios")
            .update({ notif_disponible_enviada_para: u.ultima_ruleta })
            .eq("id", u.id);
          disponibleEnviadas++;
        }
      }

      if (avisarRacha) {
        const ok = await enviarPush(
          clave,
          "🔥 ¡No pierdas tu racha!",
          `Te quedan pocas horas para girar la ruleta antes de perder tu racha de ${u.racha_ruleta}.`
        );
        if (ok) {
          await supabaseAdmin
            .from("usuarios")
            .update({ notif_racha_riesgo_enviada_para: u.ultima_ruleta })
            .eq("id", u.id);
          rachaEnviadas++;
        }
      }
    }

    return new Response(
      JSON.stringify(
        dryRun
          ? { success: true, dry_run: true, candidatos: lista.length, avisarian: detalle }
          : { success: true, candidatos: lista.length, disponibleEnviadas, rachaEnviadas }
      ),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en ruleta-notifications:", error);
    return new Response(
      JSON.stringify({ error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
