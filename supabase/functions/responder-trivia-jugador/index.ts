import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CODIGO_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generarCodigo(): string {
  let codigo = "";
  for (let i = 0; i < 8; i++) {
    codigo += CODIGO_CHARS.charAt(Math.floor(Math.random() * CODIGO_CHARS.length));
  }
  return codigo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { subscriber_id, username, pregunta_id, respuesta_index } = await req.json();

    if (!subscriber_id || !username || !pregunta_id || respuesta_index === undefined || respuesta_index === null) {
      return new Response(
        JSON.stringify({ success: false, error: "Faltan datos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Evita farmear premios pendientes de trivia sin resolver el anterior
    const { data: pendiente } = await supabaseAdmin
      .from("premios_ruleta")
      .select("id")
      .eq("usuario", username)
      .eq("subscriber_id", subscriber_id)
      .eq("estado", "pendiente")
      .eq("origen", "trivia")
      .limit(1);

    if (pendiente && pendiente.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Ya tenés un premio de trivia pendiente" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: triviaConfig } = await supabaseAdmin
      .from("trivias")
      .select("premio_correcto, periodicidad_horas")
      .eq("subscriber_id", subscriber_id)
      .eq("activa", true)
      .single();

    const horasCooldown = triviaConfig?.periodicidad_horas || 24;

    // Cooldown del lado del servidor: mismo criterio que ya usa el navegador para
    // decidir si mostrar la trivia (horas desde la última respuesta incorrecta, u
    // horas desde que se entregó el último premio), pero validado acá para que no
    // dependa de que el cliente se comporte bien (o de que tenga la versión al día).
    const { data: ultimaInteraccion } = await supabaseAdmin
      .from("trivia_mostradas")
      .select("respondida, es_correcta, respondida_en")
      .eq("usuario", username)
      .eq("subscriber_id", subscriber_id)
      .order("respondida_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ultimaInteraccion?.respondida) {
      const ahoraMs = Date.now();

      if (!ultimaInteraccion.es_correcta) {
        const horasPasadas =
          (ahoraMs - new Date(ultimaInteraccion.respondida_en).getTime()) / (1000 * 60 * 60);
        if (horasPasadas < horasCooldown) {
          return new Response(
            JSON.stringify({ success: false, error: "Todavía no podés volver a responder la trivia" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        const { data: ultimoPremio } = await supabaseAdmin
          .from("premios_ruleta")
          .select("estado, entregado_at")
          .eq("usuario", username)
          .eq("subscriber_id", subscriber_id)
          .eq("origen", "trivia")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ultimoPremio?.estado === "entregado" && ultimoPremio.entregado_at) {
          const horasPasadas =
            (ahoraMs - new Date(ultimoPremio.entregado_at).getTime()) / (1000 * 60 * 60);
          if (horasPasadas < horasCooldown) {
            return new Response(
              JSON.stringify({ success: false, error: "Todavía no podés volver a responder la trivia" }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
        // Si el último premio de trivia todavía no está "entregado", ya se bloqueó
        // arriba con el chequeo de pendiente — acá no hace falta duplicarlo.
      }
    }

    const { data: pregunta } = await supabaseAdmin
      .from("trivia_preguntas")
      .select("*")
      .eq("id", pregunta_id)
      .single();

    if (!pregunta) {
      return new Response(
        JSON.stringify({ success: false, error: "Pregunta no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const respuesta = pregunta.respuestas?.[respuesta_index];
    const esCorrecta = respuesta?.es_correcta === true;
    const respuestaCorrectaTexto =
      pregunta.respuestas?.find((r: { es_correcta: boolean }) => r.es_correcta)?.texto || "";

    await supabaseAdmin.from("trivia_mostradas").insert({
      subscriber_id,
      pregunta_id,
      usuario: username,
      respondida: true,
      es_correcta: esCorrecta,
      respondida_en: new Date().toISOString(),
      mostrada_at: new Date().toISOString(),
    });

    let premio: string | null = null;
    let codigo: string | null = null;

    if (esCorrecta) {
      premio = triviaConfig?.premio_correcto || "fichas gratis";
      codigo = generarCodigo();

      await supabaseAdmin.from("premios_ruleta").insert({
        subscriber_id,
        usuario: username,
        premio,
        codigo,
        estado: "pendiente",
        origen: "trivia",
        created_at: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({ success: true, esCorrecta, premio, codigo, respuestaCorrectaTexto }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
