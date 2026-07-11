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
    const { subscriber_id, username, estado, origen } = await req.json();

    if (!subscriber_id || !username) {
      return new Response(
        JSON.stringify({ error: "Faltan datos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let query = supabaseAdmin
      .from("premios_ruleta")
      .select("id, premio, codigo, estado, origen, created_at, entregado_at")
      .eq("usuario", username)
      .eq("subscriber_id", subscriber_id);

    if (estado) query = query.eq("estado", estado);
    if (origen) query = query.eq("origen", origen);

    const { data } = await query.order("created_at", { ascending: false }).limit(1).single();

    return new Response(
      JSON.stringify({ data: data || null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
