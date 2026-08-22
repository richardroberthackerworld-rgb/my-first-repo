import { Suspense, lazy, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SiteLayout } from './layouts/SiteLayout';
import { Splash, shouldShowSplash } from './components/Splash';
import { ToastProvider } from './components/ui/Toast';
import { SessionProvider } from './services/session';
import { SkeletonBlock, SkeletonCard } from './components/ui/States';
import { TOOL_SHORT_PATHS } from './config/tools';

/* Marketing pages load eagerly — they are small and first-paint critical. */
import Home from './pages/Home';

/* Everything else is split out so the initial bundle stays lean. */
const Tools = lazy(() => import('./pages/Tools'));
const Features = lazy(() => import('./pages/Features'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Blog = lazy(() => import('./pages/Blog'));
const BlogPost = lazy(() => import('./pages/BlogPost'));
const SignIn = lazy(() => import('./pages/SignIn'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Credits = lazy(() => import('./pages/Credits'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const Support = lazy(() => import('./pages/Support'));
const Contact = lazy(() => import('./pages/Contact'));
const Legal = lazy(() => import('./pages/Legal'));
const NotFound = lazy(() => import('./pages/NotFound'));

const VocalRemover = lazy(() => import('./pages/tools/VocalRemover'));
const StemSplitter = lazy(() => import('./pages/tools/StemSplitter'));
const NoiseRemover = lazy(() => import('./pages/tools/NoiseRemover'));
const AudioCutter = lazy(() => import('./pages/tools/AudioCutter'));
const SongJoiner = lazy(() => import('./pages/tools/SongJoiner'));
const PitchShifter = lazy(() => import('./pages/tools/PitchShifter'));
const AudioConverter = lazy(() => import('./pages/tools/AudioConverter'));

function RouteFallback() {
  return (
    <div className="container" style={{ padding: '40px 0' }}>
      <SkeletonBlock height={34} width="42%" />
      <div style={{ height: 12 }} />
      <SkeletonBlock height={16} width="64%" />
      <div style={{ height: 28 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

export default function App() {
  const [splashDone, setSplashDone] = useState(() => !shouldShowSplash());

  return (
    <SessionProvider>
      <ToastProvider>
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}

      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<Home />} />

          <Route
            path="tools"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Tools />
              </Suspense>
            }
          />
          <Route
            path="tools/vocal-remover"
            element={
              <Suspense fallback={<RouteFallback />}>
                <VocalRemover />
              </Suspense>
            }
          />
          <Route
            path="tools/stem-splitter"
            element={
              <Suspense fallback={<RouteFallback />}>
                <StemSplitter />
              </Suspense>
            }
          />
          <Route
            path="tools/noise-remover"
            element={
              <Suspense fallback={<RouteFallback />}>
                <NoiseRemover />
              </Suspense>
            }
          />
          <Route
            path="tools/audio-cutter"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AudioCutter />
              </Suspense>
            }
          />
          <Route
            path="tools/song-joiner"
            element={
              <Suspense fallback={<RouteFallback />}>
                <SongJoiner />
              </Suspense>
            }
          />
          <Route
            path="tools/pitch-shifter"
            element={
              <Suspense fallback={<RouteFallback />}>
                <PitchShifter />
              </Suspense>
            }
          />
          <Route
            path="tools/audio-converter"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AudioConverter />
              </Suspense>
            }
          />

          <Route
            path="features"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Features />
              </Suspense>
            }
          />
          <Route
            path="pricing"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Pricing />
              </Suspense>
            }
          />
          <Route
            path="blog"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Blog />
              </Suspense>
            }
          />
          <Route
            path="blog/:slug"
            element={
              <Suspense fallback={<RouteFallback />}>
                <BlogPost />
              </Suspense>
            }
          />

          <Route
            path="signin"
            element={
              <Suspense fallback={<RouteFallback />}>
                <SignIn />
              </Suspense>
            }
          />
          {/*
            Short tool URLs. These are the paths a person types or a flyer
            prints; the page itself lives at /tools/<id>, which is what the
            canonical tag and every internal link point at. Sending these
            there keeps one URL per tool instead of two competing for the
            same search. Apache answers them with a real 301 (see
            public/.htaccess); this handles the case where the router gets
            there first.
          */}
          {TOOL_SHORT_PATHS.map((id) => (
            <Route key={id} path={id} element={<Navigate to={`/tools/${id}`} replace />} />
          ))}

          <Route path="signup" element={<Navigate to="/signin" replace />} />
          <Route path="forgot-password" element={<Navigate to="/signin" replace />} />

          <Route
            path="dashboard"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="credits"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Credits />
              </Suspense>
            }
          />
          <Route
            path="profile"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Profile />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Settings />
              </Suspense>
            }
          />
          <Route
            path="contact"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Contact />
              </Suspense>
            }
          />
          <Route
            path="support"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Support />
              </Suspense>
            }
          />
          <Route
            path="privacy"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Legal kind="privacy" />
              </Suspense>
            }
          />
          <Route
            path="terms"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Legal kind="terms" />
              </Suspense>
            }
          />

          <Route
            path="*"
            element={
              <Suspense fallback={<RouteFallback />}>
                <NotFound />
              </Suspense>
            }
          />
        </Route>
      </Routes>
      </ToastProvider>
    </SessionProvider>
  );
}
