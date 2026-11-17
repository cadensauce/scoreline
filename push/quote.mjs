// Quote of the day for Home: fetched from ZenQuotes (free, attribution required; it blocks browser requests,
// so the worker fetches it) and saved to public/quote, which the site reads. Changes daily.
let lastDate = "";

export async function quoteTick(db, admin) {
  try {
    const r = await fetch("https://zenquotes.io/api/today");
    if (!r.ok) return;
    const [x] = await r.json();
    if (!x?.q || !x?.a || !x?.date || x.date === lastDate) return;
    if (/zenquotes\.io|too many requests/i.test(x.q)) return;   // their rate-limit message comes back as a "quote"
    await db.collection("public").doc("quote").set({
      q: String(x.q).slice(0, 400), a: String(x.a).slice(0, 80), date: x.date, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    lastDate = x.date;
  } catch (e) { console.log("quote error", e.message); }
}
