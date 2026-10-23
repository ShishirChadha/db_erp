import { redirect } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { NavSearchProvider } from '@/components/NavSearch';
import { RoleSeed } from '@/components/RoleSeed';
import { cookies } from 'next/headers';
import { getLayoutSessionUser, SessionCheckUnavailable } from '@/lib/auth/session';
import { ResumeSession } from '@/components/ResumeSession';
import { WebVitalsReporter } from '@/components/WebVitalsReporter';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Replaces a network call to Supabase's Auth server (auth.getUser()) with a
  // local JWT verify + one parallel revoked-check/profile query -- see
  // getLayoutSessionUser()'s own comment for why. The result also seeds
  // RoleProvider (mounted in app/layout.tsx) via <RoleSeed> below, so the
  // client no longer has to re-fetch the same role/permissions data itself on
  // every dashboard load.
  let sessionUser: Awaited<ReturnType<typeof getLayoutSessionUser>>;
  try {
    sessionUser = await getLayoutSessionUser();
  } catch (err) {
    // Could not CHECK the session (server/tunnel unreachable) -- that is not
    // the same as being signed out, so don't send the user to /login for it.
    if (err instanceof SessionCheckUnavailable) return <ResumeSession mode="unavailable" />;
    throw err;
  }

  if (!sessionUser) {
    // Access tokens last an hour, and this Server Component deliberately never
    // refreshes one (it can't save the rotated cookie). So opening the ERP
    // after a while -- next morning, after the laptop slept -- lands here with
    // an expired token but a perfectly good refresh token. If any auth cookie
    // is present, let the browser renew it and reload this same page instead
    // of dumping the user on the login form.
    const cookieName = process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME || 'sb-';
    const hasAuthCookie = (await cookies()).getAll().some(c => c.name.startsWith(cookieName));
    if (hasAuthCookie) return <ResumeSession mode="expired" />;
    redirect('/login');
  }

  return (
    <NavSearchProvider>
      <RoleSeed snapshot={sessionUser} />
      <WebVitalsReporter />
      <div className="flex h-dvh bg-muted overflow-hidden">
        <Sidebar />
        {/* pt-14 clears the fixed mobile top bar (Sidebar renders it at md:hidden) --
            without this, page content renders underneath it on phones. */}
        <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
          {/* h-full gives master-detail pages a real, browser-computed height to fill
              (main's content-box height already excludes pt-14/padding above) instead of
              a hardcoded calc(100vh - Xrem) that can't know how tall a given page's own
              header/tabs/stat-cards/filters are -- normal (non-fixed-height) pages are
              unaffected since a taller child still overflows this box and main still
              scrolls to reach it, exactly as before. */}
          <div className="p-4 md:p-6 max-w-screen-2xl mx-auto h-full">{children}</div>
        </main>
      </div>
    </NavSearchProvider>
  );
}
