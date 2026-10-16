// A stand-in for Meta's Graph API in the E2E run (M10.4): the external boundary, nothing else. A test registers the answers of a
// lead with POST /__leads (id, field_data), and the API reads them with GET /<lead id> and the Page token, as it would from Meta.
// Only a request with a bearer token is answered; a lead nobody registered is Meta's 400.
import { createServer } from "node:http";
import process from "node:process";
import { URL } from "node:url";

const port = Number(process.env.GRAPH_STUB_PORT ?? 4011);
const leads = new Map();

const send = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true });
  if (request.method === "POST" && url.pathname === "/__leads") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const lead = JSON.parse(body);
      leads.set(String(lead.id), lead);
      send(response, 201, { ok: true });
    });
    return;
  }
  const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
  if (request.method === "GET" && /^\d+$/.test(id)) {
    if (!/^Bearer \S{20,}$/.test(request.headers.authorization ?? "")) {
      return send(response, 401, { error: { message: "Invalid OAuth access token", code: 190 } });
    }
    const lead = leads.get(id);
    if (!lead) return send(response, 400, { error: { message: "Unsupported get request", code: 100 } });
    return send(response, 200, lead);
  }
  send(response, 404, { error: { message: "Unknown path" } });
}).listen(port);
