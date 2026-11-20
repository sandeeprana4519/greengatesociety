import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/societies',
  '/customers',
  '/campaigns',
  '/products',
  '/services',
  '/orders',
  '/vendors',
  '/staff',
  '/roles',
  '/reports',
  '/settings',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requiresAuth = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!requiresAuth) {
    return NextResponse.next();
  }

  // Session cookie set after Firebase ID token verification; authoritative RBAC is enforced
  // both by Firestore Security Rules and Cloud Functions.
  const hasSession = Boolean(request.cookies.get('gg_admin_session')?.value);
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/societies/:path*',
    '/customers/:path*',
    '/campaigns/:path*',
    '/products/:path*',
    '/services/:path*',
    '/orders/:path*',
    '/vendors/:path*',
    '/staff/:path*',
    '/roles/:path*',
    '/reports/:path*',
    '/settings/:path*',
  ],
};
