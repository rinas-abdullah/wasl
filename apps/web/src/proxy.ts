import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only: if there is no session cookie, send the user to /login.
 * Real authentication and authorisation happen on the API for every request.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("wasl_session");
  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|icon.png|wasl-logo.png|wasl-logo-trim.png|favicon.ico).*)"],
};
