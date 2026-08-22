import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { BottomNav } from '@/components/BottomNav';
import { InstallCard, UpdateBanner } from '@/components/InstallPrompt';
import { Seo } from '@/components/Seo';
import { Breadcrumbs } from '@/components/Breadcrumbs';

/** Reset scroll on navigation and move focus to the main region. */
function useRouteChange() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    const main = document.getElementById('main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
      main.removeAttribute('tabindex');
    }
  }, [pathname]);
}

export function SiteLayout() {
  useRouteChange();

  return (
    <>
      <a className="sr-only skip-link" href="#main">
        Skip to content
      </a>
      <Seo />
      <Header />
      <main id="main" className="app-main">
        <div className="container">
          <Breadcrumbs />
        </div>
        <Outlet />
      </main>
      <div className="container" style={{ marginTop: 24 }}>
        <InstallCard />
      </div>
      <Footer />
      <BottomNav />
      <UpdateBanner />
    </>
  );
}
