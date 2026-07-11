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
    const respuestaCorrectaTexto = pregunta.respuestas?.find((r: { es_correcta: boolean }) => r.es_correcta)?.texto || "";

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
      const { data: triviaConfig } = await supabaseAdmin
        .from("trivias")
        .select("premio_correcto")
        .eq("subscriber_id", subscriber_id)
        .eq("activa", true)
        .single();

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
