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
    const { username, password, subscriber_id, ip } = await req.json();

    if (!username || !password || !subscriber_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Todos los campos son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (ip) {
      const { data: usuariosExistentes } = await supabaseAdmin
        .from("usuarios")
        .select("id")
        .eq("subscriber_id", subscriber_id)
        .eq("ultima_ip", ip);

      if (usuariosExistentes && usuariosExistentes.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Ya tienes un usuario registrado desde este dispositivo con este agente.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { error } = await supabaseAdmin.from("usuarios").insert({
      username,
      password,
      subscriber_id,
      ultima_ip: ip || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code === "23505") {
        return new Response(
          JSON.stringify({ success: false, error: "Ese nombre de usuario ya está en uso." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: "Ocurrió un error al crear el usuario." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
