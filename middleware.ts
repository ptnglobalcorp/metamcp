import { NextRequest, NextResponse } from 'next/server';

// Flag to track if we've already shown the warning
let hasShownAuthWarning = false;

export function middleware(request: NextRequest) {
  // Skip authentication for API routes that might need to be public
  // You can customize this list based on your needs
  const publicPaths = [
    '/api',           // All API routes use their own API key authentication
    '/favicon.ico',
    '/_next',
    '/public'
  ];

  // Check if the current path should skip authentication
  const isPublicPath = publicPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  );

  if (isPublicPath) {
    return NextResponse.next();
  }

  // Get basic auth credentials from environment variables
  const expectedUsername = process.env.BASIC_AUTH_USERNAME;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  // If no credentials are set in environment, skip authentication
  if (!expectedUsername || !expectedPassword) {
    // Only show warning once on app start
    if (!hasShownAuthWarning) {
      console.warn('BASIC_AUTH_USERNAME or BASIC_AUTH_PASSWORD not set. Skipping authentication.');
      hasShownAuthWarning = true;
    }
    return NextResponse.next();
  }

  // Get the authorization header
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    // Return 401 with WWW-Authenticate header to prompt for credentials
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Area"',
      },
    });
  }

  // Decode the base64 credentials
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  // Verify credentials
  if (username !== expectedUsername || password !== expectedPassword) {
    return new NextResponse('Invalid credentials', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Area"',
      },
    });
  }

  // Authentication successful, continue to the requested page
  return NextResponse.next();
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