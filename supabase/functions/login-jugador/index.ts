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
    const { username, password, expected_subscriber_id } = await req.json();

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: "Usuario y contraseña son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Si llega expected_subscriber_id (link o instalación ya vinculada), filtramos
    // estrictamente por ese suscriptor: nunca deja mezclar credenciales de otro.
    // Si no llega (instalación nueva sin contexto, típico en iOS), buscamos sin
    // filtrar: el login determina el suscriptor y el cliente lo vincula de forma
    // permanente a partir de ahí.
    let query = supabaseAdmin
      .from("usuarios")
      .select(
        "subscriber_id, suscriptores(id, nombre_casino, sala1_link, sala2_link, sala3_link, sala4_link, chatwoot_website_token, primary_color, accent_color, button_text_color, modal_border_color)"
      )
      .eq("username", username)
      .eq("password", password);

    if (expected_subscriber_id) {
      query = query.eq("subscriber_id", expected_subscriber_id);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: "Credenciales incorrectas o no pertenecen a este agente." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
