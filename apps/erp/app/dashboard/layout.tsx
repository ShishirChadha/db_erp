import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/sidebar';
import { NavSearchProvider } from '@/components/NavSearch';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <NavSearchProvider>
      <div className="flex h-screen bg-muted overflow-hidden">
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