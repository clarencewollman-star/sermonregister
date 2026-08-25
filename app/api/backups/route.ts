const databaseUrl = (request: Request) => {
  const servicesUrl =
    process.env.SERMON_API_URL ?? "http://127.0.0.1:3001/services";
  const backend = new URL(servicesUrl.replace(/\/services$/, "/backups"));
  backend.search = new URL(request.url).search;
  return backend;
};

async function forward(
  method: "GET" | "POST" | "DELETE",
  request: Request,
) {
  try {
    const response = await fetch(databaseUrl(request), {
      method,
      headers: method !== "GET" ? { "Content-Type": "application/json" } : undefined,
      body: method !== "GET" ? await request.text() : undefined,
      cache: "no-store",
      signal: request.signal,
    });
    const headers = new Headers();
    headers.set(
      "Content-Type",
      response.headers.get("Content-Type") ?? "application/octet-stream",
    );
    for (const name of ["Content-Disposition", "Content-Length", "X-Backup-Job-Id"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      { error: "The SQLite database service is unavailable." },
      { status: 503 },
    );
  }
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return forward("GET", request);
}

export async function POST(request: Request) {
  return forward("POST", request);
}

export async function DELETE(request: Request) {
  return forward("DELETE", request);
}
