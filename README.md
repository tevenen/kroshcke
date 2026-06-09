# Plate Watcher 🚗

A zero-dependency Node.js app that receives PlateRecognizer webhooks and displays results on a live dashboard.

## Requirements

- Node.js 14+
- No npm packages needed

## Quick Start

```bash
node server.js
# Server starts at http://localhost:3000
```

Set a custom port with the `PORT` environment variable:
```bash
PORT=8080 node server.js
```

## Webhook Setup (PlateRecognizer)

1. Start the server and expose it publicly (e.g. via [ngrok](https://ngrok.com)):
   ```bash
   ngrok http 3000
   ```

2. Copy the public URL, e.g. `https://abc123.ngrok.io/webhook`

3. In your PlateRecognizer account → **Cameras** → **Edit** → set the **Webhook URL** to the above.

4. PlateRecognizer will POST JSON to `/webhook` on every plate detection. Results appear instantly on the dashboard.

## Endpoints

| Method | Path        | Description                    |
|--------|-------------|--------------------------------|
| POST   | /webhook    | Receive PlateRecognizer events |
| GET    | /           | Live dashboard                 |
| GET    | /events     | SSE stream (used by dashboard) |
| GET    | /api/reads  | JSON list of all stored reads  |
| DELETE | /api/reads  | Clear all stored reads         |

## PlateRecognizer Payload Format

The app handles the standard PlateRecognizer webhook payload:

```json
{
  "camera_id": "cam-01",
  "filename": "image.jpg",
  "results": [
    {
      "plate": "ABC1234",
      "score": 0.92,
      "dscore": 0.88,
      "region": { "code": "de" },
      "vehicle": {
        "type": "Car",
        "color": [{ "color": "white", "score": 0.8 }],
        "make_model": [{ "make": "BMW", "model": "3 Series", "score": 0.7 }]
      }
    }
  ]
}
```

## Features

- **Zero dependencies** — uses only Node.js built-ins
- **Real-time updates** via Server-Sent Events (SSE)
- **Live statistics**: total reads, last-hour count, unique plates, avg confidence
- **Detailed cards**: plate number, confidence, region, vehicle type/color/make/model
- **In-memory storage** — last 100 reads kept while server is running
