import directoryJson from "./directory.json" with { type: "json" };
import {
  corsHeaders,
  createServiceClient,
  getCallerUserId,
  jsonResponse,
  resolveCorsOrigin,
} from "../_shared/supabase.ts";
import { type Directory, searchDirectory } from "./search.ts";

const directory = directoryJson as Directory;

Deno.serve(async (req) => {
  const response = await handleRequest(req);
  response.headers.set("Access-Control-Allow-Origin", resolveCorsOrigin(req));
  return response;
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!await getCallerUserId(req, createServiceClient())) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const action = (body as Record<string, unknown>).action;
  if (action === "places") {
    return jsonResponse({
      snapshotDate: directory.snapshotDate,
      places: directory.places.map(({ code, name, province }) => ({
        code,
        name,
        province,
      })),
    });
  }
  if (action === "search") {
    try {
      return jsonResponse(searchDirectory(directory, body));
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return jsonResponse({ error: error.message }, 400);
      }
      return jsonResponse({ error: "Facility search unavailable" }, 500);
    }
  }
  return jsonResponse({ error: "Unknown action" }, 400);
}
