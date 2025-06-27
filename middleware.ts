import type { NextRequest } from 'next/server';
import { auth0 } from './lib/auth0';

export async function middleware(request: NextRequest) {
  return await auth0.middleware(request);
}

export const config = {
  // Match all paths except static files and API routes you want to keep public
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * You can add more exclusions here as needed
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
