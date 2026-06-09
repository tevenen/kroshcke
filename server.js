const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

// In-memory store for plate reads (most recent first, max 100)
const plateReads = [];
const MAX_READS = 100;

// SSE clients
const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Webhook ──────────────────────────────────────────────────────────────
  if (url.pathname === "/webhook" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);

        // PlateRecognizer sends { results: [...], ... } or wraps in { data: {...} }
        // Support both formats.
        const inner =
          payload.data || payload;
        const results = inner.results || [];

        const read = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          camera: inner.camera_id || payload.camera_id || "Unknown camera",
          filename: inner.filename || payload.filename || null,
          vehicle: null,
          plates: results.map((r) => ({
            plate: r.plate?.toUpperCase() || "—",
            score: r.score != null ? Math.round(r.score * 100) : null,
            dscore: r.dscore != null ? Math.round(r.dscore * 100) : null,
            region: r.region?.code || null,
            direction: r.direction || null,
            vehicle: r.vehicle
              ? {
                  type: r.vehicle.type,
                  color: r.vehicle.color?.[0]?.color || null,
                  make: r.vehicle.make_model?.[0]?.make || null,
                  model: r.vehicle.make_model?.[0]?.model || null,
                  score: r.vehicle.score != null ? Math.round(r.vehicle.score * 100) : null,
                }
              : null,
          })),
          raw: payload,
        };
        console.log("New read received:", read);

        plateReads.unshift(read);
        if (plateReads.length > MAX_READS) plateReads.pop();

        broadcast({ type: "new_read", read });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("Webhook parse error:", err.message);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      }
    });
    return;
  }

  // ── SSE stream ───────────────────────────────────────────────────────────
  if (url.pathname === "/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`data: ${JSON.stringify({ type: "init", reads: plateReads })}\n\n`);

    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // ── API: all reads ────────────────────────────────────────────────────────
  if (url.pathname === "/api/reads" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(plateReads));
    return;
  }

  // ── API: clear reads ──────────────────────────────────────────────────────
  if (url.pathname === "/api/reads" && req.method === "DELETE") {
    plateReads.length = 0;
    broadcast({ type: "cleared" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Static: index.html ────────────────────────────────────────────────────
  if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
    const file = path.join(__dirname, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Could not read index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n🚗  Plate Watcher running on http://localhost:${PORT}`);
  console.log(`📡  Webhook endpoint: POST http://localhost:${PORT}/webhook\n`);
});
