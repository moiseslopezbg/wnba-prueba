export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({error:'Falta configurar ODDS_API_KEY en las variables de entorno de Vercel.'});

  const url = new URL('https://api.the-odds-api.com/v4/sports/basketball_wnba/odds');
  url.searchParams.set('apiKey', key);
  url.searchParams.set('regions', 'eu,us');
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'decimal');

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({error:data?.message || 'The Odds API devolvió un error.'});
    res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({error:`Error al consultar The Odds API: ${e.message}`});
  }
}
