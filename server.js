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
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const rawBuffer = Buffer.concat(chunks);
      const rawBody = rawBuffer.toString("utf8");
      const contentType = req.headers["content-type"] || "";

      console.log("[webhook] content-type:", contentType);
      console.log("[webhook] raw body:", rawBody.slice(0, 500));

      let payload = null;

      try {
        if (contentType.includes("application/json")) {
          // Standard JSON
          payload = JSON.parse(rawBody);
        } else if (contentType.includes("multipart/form-data")) {
          // PlateRecognizer ALPR stream sends multipart; extract the JSON field named "json"
          const boundary = contentType.split("boundary=")[1]?.trim();
          if (boundary) {
            const jsonMatch = rawBody.match(/name="json"\s*\r?\n\r?\n([\s\S]*?)(?:\r?\n--)/);
            if (jsonMatch) payload = JSON.parse(jsonMatch[1].trim());
          }
          // Fallback: try to find any JSON object in the body
          if (!payload) {
            const jsonMatch = rawBody.match(/\{[\s\S]*\}/);
            if (jsonMatch) payload = JSON.parse(jsonMatch[0]);
          }
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          // URL-encoded: decode and look for a 'json' field
          const params = new URLSearchParams(rawBody);
          const jsonField = params.get("json") || params.get("data") || params.get("payload");
          if (jsonField) payload = JSON.parse(jsonField);
          else payload = Object.fromEntries(params.entries());
        } else {
          // Unknown — try JSON anyway
          payload = JSON.parse(rawBody);
        }
      } catch (parseErr) {
        console.error("[webhook] parse error:", parseErr.message);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Could not parse body", raw: rawBody.slice(0, 200) }));
        return;
      }
      console.log("[webhook] parsed payload:", payload);
      if (!payload) {
        console.error("[webhook] empty payload after parsing");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Empty payload" }));
        return;
      }

      try {
        // PlateRecognizer sends { results: [...], ... } or wraps in { data: {...} }
        const inner = payload.data || payload;
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

        plateReads.unshift(read);
        if (plateReads.length > MAX_READS) plateReads.pop();

        broadcast({ type: "new_read", read });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("[webhook] processing error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
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