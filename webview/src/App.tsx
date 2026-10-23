// Main application component; configures memory routing, theme provider, rich text editor context, and background listeners.
import { lazy, Suspense } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import Layout from "./components/Layout";
import { MainEditorProvider } from "./components/mainInput/TipTapEditor";

import { VscThemeProvider } from "./context/VscTheme";
import ParallelListeners from "./hooks/ParallelListeners";
import ErrorPage from "./pages/error";
import Chat from "./pages/gui";
import { ROUTES } from "./util/navigation";

const ConfigPage = lazy(() => import("./pages/config"));
const History = lazy(() => import("./pages/history"));
const Stats = lazy(() => import("./pages/stats"));
const ThemePage = lazy(() => import("./styles/ThemePage"));

// Fallback indicator displayed while lazy-loaded route views are being resolved.
const RouteFallback = () => (
  <div style={{ padding: "16px", fontSize: "12px", opacity: 0.7 }}>Loading...</div>
);

const initialRoute =
  typeof window !== "undefined" && (window as any).initialRoute
    ? (window as any).initialRoute
    : ROUTES.HOME;

// Memory router defining route hierarchy between Chat, History, Settings, Stats, and Theme within Layout.
const router = createMemoryRouter(
  [
    {
      path: ROUTES.HOME,
      element: <Layout />,
      errorElement: <ErrorPage />,
      children: [
        {
          path: "/index.html",
          element: <Chat />,
        },
        {
          path: ROUTES.HOME,
          element: <Chat />,
        },
        {
          path: "/history",
          element: (
            <Suspense fallback={<RouteFallback />}>
              <History />
            </Suspense>
          ),
        },
        {
          path: ROUTES.STATS,
          element: (
            <Suspense fallback={<RouteFallback />}>
              <Stats />
            </Suspense>
          ),
        },
        {
          path: ROUTES.CONFIG,
          element: (
            <Suspense fallback={<RouteFallback />}>
              <ConfigPage />
            </Suspense>
          ),
        },
        {
          path: ROUTES.THEME,
          element: (
            <Suspense fallback={<RouteFallback />}>
              <ThemePage />
            </Suspense>
          ),
        },
      ],
    },
  ],
  {
    initialEntries: [initialRoute],
    initialIndex: 0,
  }
);

// Assembles the core application shell: VscThemeProvider manages theme CSS variables, MainEditorProvider shares editor state,
// RouterProvider controls view routing within Layout, and ParallelListeners processes background extension IPC messages.
function App() {
  return (
    <VscThemeProvider>
      <MainEditorProvider>
          <RouterProvider router={router} />
      </MainEditorProvider>
      <ParallelListeners />
    </VscThemeProvider>
  );
}

export default App;
