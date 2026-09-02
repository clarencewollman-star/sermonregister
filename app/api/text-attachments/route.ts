const databaseUrl = (request: Request) => {
  const servicesUrl =
    process.env.SERMON_API_URL ?? "http://127.0.0.1:3001/services";
  const backend = new URL(servicesUrl.replace(/\/services$/, "/text-attachments"));
  backend.search = new URL(request.url).search;
  return backend;
};

async function forward(
  method: "GET" | "POST" | "PUT" | "DELETE",
  request: Request,
) {
  try {
    const response = await fetch(databaseUrl(request), {
      method,
      headers: method !== "GET" ? { "Content-Type": "application/json" } : undefined,
      body: method !== "GET" ? await request.text() : undefined,
      cache: "no-store",
    });
    const headers = new Headers();
    headers.set(
      "Content-Type",
      response.headers.get("Content-Type") ?? "application/octet-stream",
    );
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
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

export async function PUT(request: Request) {
  return forward("PUT", request);
}

export async function DELETE(request: Request) {
  return forward("DELETE", request);
}
