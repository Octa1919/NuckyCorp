import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { subscriber_id } = await req.json();

    if (!subscriber_id) {
      return new Response(
        JSON.stringify({ error: "Falta subscriber_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: preguntas } = await supabaseAdmin
      .from("trivia_preguntas")
      .select("id, pregunta, respuestas")
      .eq("subscriber_id", subscriber_id)
      .eq("activa", true);

    if (!preguntas || preguntas.length === 0) {
      return new Response(
        JSON.stringify({ data: null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const elegida = preguntas[Math.floor(Math.random() * preguntas.length)];

    // Nunca mandamos cual respuesta es la correcta al navegador
    const respuestasSinCorrecta = (elegida.respuestas || []).map((r: { texto: string }) => ({
      texto: r.texto,
    }));

    return new Response(
      JSON.stringify({ data: { id: elegida.id, pregunta: elegida.pregunta, respuestas: respuestasSinCorrecta } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
