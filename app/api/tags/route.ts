const databaseUrl = () => {
  const servicesUrl =
    process.env.SERMON_API_URL ?? "http://127.0.0.1:3001/services";
  return servicesUrl.replace(/\/services$/, "/tags");
};

async function forward(
  method: "GET" | "POST" | "PUT" | "DELETE",
  request?: Request,
) {
  try {
    const response = await fetch(databaseUrl(), {
      method,
      headers: method !== "GET" ? { "Content-Type": "application/json" } : undefined,
      body: method !== "GET" ? await request?.text() : undefined,
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return Response.json(
      { error: "The SQLite database service is unavailable." },
      { status: 503 },
    );
  }
}

export const dynamic = "force-dynamic";

export async function GET() {
  return forward("GET");
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
