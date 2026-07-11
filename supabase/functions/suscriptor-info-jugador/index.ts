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

    const { data, error } = await supabaseAdmin
      .from("suscriptores")
      .select(
        "id, nombre_casino, whatsapp, telegram, instagram, sala1_link, sala2_link, sala3_link, sala4_link, dias_dorada, premios_normal, premios_dorada, cronograma_url, cronograma_updated_at, chatwoot_website_token, primary_color, accent_color, button_text_color, modal_border_color"
      )
      .eq("id", subscriber_id)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: "No se encontró el suscriptor" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
