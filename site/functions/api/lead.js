export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const consent = String(formData.get("consent") || "").trim();

    const utm = {
      source: String(formData.get("utm_source") || "").trim(),
      medium: String(formData.get("utm_medium") || "").trim(),
      campaign: String(formData.get("utm_campaign") || "").trim(),
      content: String(formData.get("utm_content") || "").trim(),
      term: String(formData.get("utm_term") || "").trim()
    };

    if (!name || !email || !consent) {
      return Response.json({ ok: false, error: "Dati mancanti." }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ ok: false, error: "Email non valida." }, { status: 400 });
    }

    const apiKey = context.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY is not configured");
      return Response.json({ ok: false, error: "Servizio email non configurato." }, { status: 500 });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Budget Reset <support@zirofy.app>",
        reply_to: "support@zirofy.app",
        to: [email],
        subject: "Il tuo Budget Reset è pronto",
        text: `Ciao ${name},\n\nhai fatto il primo passo.\n\nIl tuo Budget Reset gratuito è pronto.\n\nAprilo qui:\nhttps://zirofy.app/free-app/budget-reset-solo.html\n\nTi bastano circa 10 minuti per inserire entrate e spese e capire quanto puoi davvero spendere questo mese.\n\nNei prossimi giorni ti accompagneremo con indicazioni semplici per trasformare il primo reset in un'abitudine.\n\nA presto,\nBudget Reset`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717;max-width:640px;margin:0 auto;padding:24px">
            <p>Ciao ${escapeHtml(name)},</p>
            <p>hai fatto il primo passo.</p>
            <p>Il tuo <strong>Budget Reset gratuito</strong> è pronto.</p>
            <p>
              <a href="https://zirofy.app/free-app/budget-reset-solo.html"
                 style="display:inline-block;padding:14px 20px;background:#c6ff2d;color:#111;text-decoration:none;border-radius:8px;font-weight:700">
                APRI IL BUDGET RESET →
              </a>
            </p>
            <p>Ti bastano circa 10 minuti per inserire entrate e spese e capire quanto puoi davvero spendere questo mese.</p>
            <p>Nei prossimi giorni ti accompagneremo con indicazioni semplici per trasformare il primo reset in un'abitudine.</p>
            <p>A presto,<br>Budget Reset</p>
          </div>
        `
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Resend API error", response.status, result);
      return Response.json({ ok: false, error: "Invio email non riuscito." }, { status: 502 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Lead endpoint error", error);
    return Response.json({ ok: false, error: "Errore inatteso." }, { status: 500 });
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
