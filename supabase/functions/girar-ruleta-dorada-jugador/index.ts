import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PREMIOS_DORADOS_DEFAULT = ["50k Fichas", "Bono 100%", "Jackpot", "200k Fichas", "Bono 200%", "Ruleta Extra"];
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
    const { subscriber_id, username } = await req.json();

    if (!subscriber_id || !username) {
      return new Response(
        JSON.stringify({ success: false, error: "Faltan datos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. ¿Ya tiene un premio de ruleta pendiente?
    const { data: pendiente } = await supabaseAdmin
      .from("premios_ruleta")
      .select("id")
      .eq("usuario", username)
      .eq("subscriber_id", subscriber_id)
      .eq("estado", "pendiente")
      .eq("origen", "ruleta")
      .limit(1);

    if (pendiente && pendiente.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Ya tenés un premio pendiente" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: user } = await supabaseAdmin
      .from("usuarios")
      .select("ultima_ruleta, racha_ruleta")
      .eq("username", username)
      .eq("subscriber_id", subscriber_id)
      .single();

    if (!user) {
      return new Response(
        JSON.stringify({ success: false, error: "Usuario no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Chequeo de cooldown de 24hs
    if (user.ultima_ruleta) {
      const horasPasadas = (Date.now() - new Date(user.ultima_ruleta).getTime()) / (1000 * 60 * 60);
      if (horasPasadas < 24) {
        return new Response(
          JSON.stringify({ success: false, error: "cooldown", ultima_ruleta: user.ultima_ruleta }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 3. Chequeo de elegibilidad para la Ruleta Dorada (racha suficiente)
    const { data: sub } = await supabaseAdmin
      .from("suscriptores")
      .select("dias_dorada, premios_dorada")
      .eq("id", subscriber_id)
      .single();

    const diasParaDorada = sub?.dias_dorada || 7;
    const rachaActual = user.racha_ruleta || 0;

    if (rachaActual < diasParaDorada) {
      return new Response(
        JSON.stringify({ success: false, error: "No alcanzaste la racha necesaria para la Ruleta Dorada" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Elegimos el premio (del lado del servidor)
    const lista = sub?.premios_dorada
      ? sub.premios_dorada.split(",").map((p: string) => p.trim())
      : PREMIOS_DORADOS_DEFAULT;

    const winningIndex = Math.floor(Math.random() * 6);
    // La flecha de la ruleta queda un casillero desfasada respecto al orden de la lista
    const correctedIndex = (winningIndex - 1 + 6) % 6;
    const premio = (lista[correctedIndex] || "Premio Dorado").replace(/\//g, " ");
    const codigo = generarCodigo();

    // 5. Guardamos el premio y actualizamos el cooldown
    await supabaseAdmin.from("premios_ruleta").insert({
      subscriber_id,
      usuario: username,
      premio,
      codigo,
      estado: "pendiente",
      origen: "ruleta",
      created_at: new Date().toISOString(),
    });

    await supabaseAdmin
      .from("usuarios")
      .update({ ultima_ruleta: new Date().toISOString() })
      .eq("username", username)
      .eq("subscriber_id", subscriber_id);

    return new Response(
      JSON.stringify({ success: true, winningIndex, premio, codigo }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
