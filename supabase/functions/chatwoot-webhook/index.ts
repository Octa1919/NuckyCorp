const ONESIGNAL_APP_ID = "f1d17c3e-a156-4a64-a288-c1a4f04f686d";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")!;
const CHATWOOT_WEBHOOK_SECRET = Deno.env.get("CHATWOOT_WEBHOOK_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const secretRecibido = url.searchParams.get("secret");
  const debug = url.searchParams.get("debug") === "true";

  // Chatwoot no manda headers personalizados en su webhook nativo, así que
  // validamos con un secreto en la URL: .../chatwoot-webhook?secret=XXX
  // Se configura una vez por cada cuenta de Chatwoot (la compartida y cada
  // cuenta propia de un suscriptor) con el mismo secreto.
  if (!CHATWOOT_WEBHOOK_SECRET || secretRecibido !== CHATWOOT_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();

    const event = body.event || "";
    const message = body;

    if (event !== "message_created") {
      return new Response(JSON.stringify({ ok: true, skipped: event }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageType = message.message_type;
    const esPrivado = message.private === true;
    const sender = message.sender || {};
    const meta = message.conversation?.meta || {};
    const metaSender = meta.sender || {};

    // No avisamos por notas internas: private=true significa que el jugador
    // nunca ve ese mensaje, así que tampoco debería recibir un push por él.
    const isAgentMessage = !esPrivado && (messageType === "outgoing" || sender.type === "user");

    if (!isAgentMessage) {
      const motivo = esPrivado ? "Nota privada" : "Not agent message";
      if (debug) {
        const resultadoDebug = { ok: true, skipped: motivo, event, messageType, esPrivado };
        console.log("🔎 [DEBUG chatwoot-webhook]", JSON.stringify(resultadoDebug));
        return new Response(JSON.stringify(resultadoDebug), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, skipped: motivo }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === BÚSQUEDA DEL IDENTIFIER ===
    let identifier =
      sender.identifier ||
      metaSender.identifier ||
      message.contact?.identifier;

    // Si el identifier NO tiene "__", intentamos reconstruirlo (identificadores
    // viejos que se guardaron antes de incluir el subscriber_id).
    if (identifier && !identifier.includes("__")) {
      const customAttrs =
        metaSender.custom_attributes ||
        meta.sender?.custom_attributes ||
        message.conversation?.meta?.sender?.custom_attributes ||
        {};

      const subscriberIdFromAttrs = customAttrs.subscriber_id;

      if (subscriberIdFromAttrs) {
        identifier = `${identifier}__${subscriberIdFromAttrs}`;
      } else {
        console.warn("⚠️ Identifier viejo sin subscriber_id en custom_attributes:", identifier);
      }
    }

    if (debug) {
      const resultadoDebug = { ok: true, event, messageType, esPrivado, identifier, isAgentMessage };
      console.log("🔎 [DEBUG chatwoot-webhook]", JSON.stringify(resultadoDebug));
      return new Response(JSON.stringify(resultadoDebug), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!identifier) {
      console.error("❌ No se encontró identifier en el webhook:", JSON.stringify(body));
      return new Response(JSON.stringify({ error: "No identifier found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: "Nucky Casino", es: "Nucky Casino" },
      contents: {
        en: "You have a new message from your agent 💬",
        es: "Tenés un mensaje nuevo de tu agente 💬",
      },
      include_aliases: { external_id: [identifier] },
      target_channel: "push",
      url: "https://nucky-corp.vercel.app",
    };

    const response = await fetch("https://api.onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("❌ Error de OneSignal:", result);
    }

    return new Response(JSON.stringify({ success: response.ok, identifier }), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("❌ Error en Edge Function chatwoot-webhook:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
