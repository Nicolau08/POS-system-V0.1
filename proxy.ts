import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  // Keep proxy as a no-op to avoid route fallbacks to 404 in dev.
  return NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
