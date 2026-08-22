import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { seoFor } from '@/config/seo';

/**
 * The visible trail that matches the BreadcrumbList <Seo> emits.
 *
 * Google only shows breadcrumbs in a result when the markup describes
 * something the page actually has, so the two are driven by the same entry in
 * the route table rather than written twice.
 *
 * `override` is for pages whose trail is not knowable from the path alone —
 * a blog post's title, for instance.
 */
export function Breadcrumbs({ override }: { override?: { label: string; path: string }[] }) {
  const { pathname } = useLocation();
  const trail = override ?? seoFor(pathname)?.breadcrumbs;

  if (!trail || trail.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        <li>
          <Link to="/" aria-label="Home">
            <Home size={13} aria-hidden="true" />
          </Link>
        </li>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={crumb.path}>
              <ChevronRight size={13} aria-hidden="true" className="breadcrumb-sep" />
              {last ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <Link to={crumb.path}>{crumb.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
