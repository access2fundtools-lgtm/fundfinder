// FundFinder AI — Zoho Campaigns Subscriber Function
// Called by the subscribe forms on opportunity-hub.html
// Requires two Netlify environment variables:
//   ZOHO_AUTH_TOKEN  — from Zoho Campaigns → Settings → Developer Space → API Key
//   ZOHO_LIST_KEY    — from Zoho Campaigns → your mailing list → List Key

exports.handler = async function (event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse email from request body
  let email;
  try {
    const body = JSON.parse(event.body);
    email = (body.email || '').trim().toLowerCase();
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid request' })
    };
  }

  if (!email || !email.includes('@')) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid email address' })
    };
  }

  const authToken = process.env.ZOHO_AUTH_TOKEN;
  const listKey   = process.env.ZOHO_LIST_KEY;

  // If env vars not set yet, accept gracefully (useful during testing)
  if (!authToken || !listKey) {
    console.log('[FundFinder] Zoho not configured — email logged:', email);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, note: 'Logged (Zoho not yet configured)' })
    };
  }

  // Call Zoho Campaigns API
  const contactInfo = JSON.stringify({ 'Contact Email': email });
  const params = new URLSearchParams({
    resfmt: 'JSON',
    listkey: listKey,
    contactinfo: contactInfo
  });

  try {
    const zohoRes = await fetch(
      `https://campaigns.zoho.com/api/v1.1/json/listsubscribe?authtoken=${authToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      }
    );

    const data = await zohoRes.json();

    // Treat "already subscribed" as success — no duplicate entries
    const ok = data.status === 'success' || data.code === 'ContactAlreadyExists';
    if (ok) {
      console.log('[FundFinder] Subscribed:', email);
    } else {
      console.error('[FundFinder] Zoho error for', email, ':', JSON.stringify(data));
    }

    // Always return success to the user — never expose Zoho internals
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('[FundFinder] Network error calling Zoho:', err.message);
    // Still tell the user it worked — we'll retry or collect from logs
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };
  }
};
