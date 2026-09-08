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

    const utmLines = Object.entries(utm)
      .filter(([, value]) => value)
      .map(([key, value]) => `<li><strong>${key}</strong>: ${escapeHtml(value)}</li>`)
      .join("");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Budget Reset <reset@zirofy.app>",
        to: [email],
        subject: "Il tuo Budget Reset è pronto ✅",
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717;max-width:640px;margin:0 auto;padding:24px">
            <h1 style="margin:0 0 12px">Ciao ${escapeHtml(name)},</h1>
            <p>hai fatto il primo passo. Il tuo <strong>Budget Reset</strong> è qui.</p>
            <p>
              <a href="https://zirofy.app/free-app/budget-reset-solo.html"
                 style="display:inline-block;padding:14px 20px;background:#c6ff2d;color:#111;text-decoration:none;border-radius:8px;font-weight:700">
                APRI IL BUDGET RESET →
              </a>
            </p>
            <p>Dedica circa 10 minuti: inserisci entrate e uscite e scopri quanto puoi davvero spendere.</p>
            <p>Nei prossimi giorni ti accompagneremo con indicazioni semplici per trasformare il primo reset in un'abitudine.</p>
            ${utmLines ? `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#666">Dati di provenienza della richiesta:</p><ul style="font-size:12px;color:#666">${utmLines}</ul>` : ""}
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
