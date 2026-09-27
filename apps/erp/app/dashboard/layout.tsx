import { redirect } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { NavSearchProvider } from '@/components/NavSearch';
import { RoleSeed } from '@/components/RoleSeed';
import { getLayoutSessionUser } from '@/lib/auth/session';

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
  const sessionUser = await getLayoutSessionUser();

  if (!sessionUser) {
    redirect('/login');
  }

  return (
    <NavSearchProvider>
      <RoleSeed snapshot={sessionUser} />
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
