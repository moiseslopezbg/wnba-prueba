// Vercel Serverless Function — WNBA Stats proxy
// Uses the WNBA Stats host and keeps LeagueID first in the query string.
// The WNBA Stats API has been returning HTML/Cloudflare pages for some
// parameter orderings, so do NOT replace this with stats.nba.com.

const TEAMS = new Set([
  "ATL", "CHI", "CON", "DAL", "GSV", "IND", "LVA",
  "LAS", "MIN", "NYL", "PHX", "PDX", "SEA", "TOR", "WAS"
]);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=300");
  res.end(JSON.stringify(body));
}

function rowsFromResult(data) {
  const sets = data?.resultSets || data?.resultSet;
  if (!sets) throw new Error("La API WNBA no devolvió resultSets.");

  const set = Array.isArray(sets) ? sets[0] : sets;
  const headers = set?.headers || [];
  const rows = set?.rowSet || [];

  return rows.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
  );
}

function opponent(matchup, team) {
  const m = String(matchup || "");
  const t = String(team || "");
  const cleaned = m
    .replace(t, "")
    .replace("vs.", "")
    .replace("@", "")
    .replace(/\s+/g, "");
  return cleaned;
}

function normalisePlayers(rows) {
  return rows
    .filter(r => TEAMS.has(r.TEAM_ABBREVIATION))
    .map(r => {
      const pts = Number(r.PTS || 0);
      const reb = Number(r.REB || 0);
      const ast = Number(r.AST || 0);
      const fg3m = Number(r.FG3M || 0);

      return {
        ...r,
        PTS: pts,
        REB: reb,
        AST: ast,
        FG3M: fg3m,
        PRA: pts + reb + ast,
        PR: pts + reb,
        PA: pts + ast,
        AR: ast + reb,
        RIVAL: opponent(r.MATCHUP, r.TEAM_ABBREVIATION)
      };
    })
    .filter(r => TEAMS.has(r.RIVAL));
}

function normaliseTeams(rows) {
  return rows
    .filter(r => TEAMS.has(r.TEAM_ABBREVIATION))
    .map(r => ({
      ...r,
      PTS: Number(r.PTS || 0),
      RIVAL: opponent(r.MATCHUP, r.TEAM_ABBREVIATION)
    }))
    .filter(r => TEAMS.has(r.RIVAL));
}

async function fetchWNBA(playerOrTeam, season) {
  // IMPORTANT: keep these in this order.
  const params = new URLSearchParams();
  params.set("LeagueID", "10");
  params.set("PlayerOrTeam", playerOrTeam);
  params.set("Season", String(season));
  params.set("SeasonType", "Regular Season");

  const url =
    "https://stats.wnba.com/stats/leaguegamefinder?" + params.toString();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.wnba.com/",
      "Origin": "https://www.wnba.com",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `WNBA Stats HTTP ${response.status}: ${text.slice(0, 180)}`
    );
  }

  // Do not blindly call response.json(): WNBA Stats can return HTML.
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json") && !text.trim().startsWith("{")) {
    throw new Error(
      `WNBA Stats devolvió ${contentType || "texto"} en vez de JSON: ` +
      text.slice(0, 180)
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta WNBA no válida: ${text.slice(0, 180)}`);
  }

  return rowsFromResult(data);
}

module.exports = async function handler(req, res) {
  try {
    const type = String(req.query?.type || "players").toLowerCase();

    // WNBA seasons are represented by a single year (e.g. 2026).
    const season = Number(req.query?.season || new Date().getUTCFullYear());

    if (!Number.isInteger(season) || season < 1997 || season > 2100) {
      return json(res, 400, {
        ok: false,
        error: "Temporada WNBA no válida."
      });
    }

    if (type === "players") {
      const rows = normalisePlayers(
        await fetchWNBA("P", season)
      );

      return json(res, 200, {
        ok: true,
        season,
        players: rows,
        data: rows
      });
    }

    if (type === "teams") {
      const rows = normaliseTeams(
        await fetchWNBA("T", season)
      );

      return json(res, 200, {
        ok: true,
        season,
        teams: rows,
        data: rows
      });
    }

    return json(res, 400, {
      ok: false,
      error: "Tipo no válido. Usa players o teams."
    });
  } catch (error) {
    console.error("WNBA API error:", error);

    return json(res, 502, {
      ok: false,
      error: error?.message || "No se pudieron cargar los datos WNBA."
    });
  }
};
