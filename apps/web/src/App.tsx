import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PlayerProvider } from './contexts/PlayerContext'
import { CollectionPage } from './pages/CollectionPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { MatchesPage } from './pages/MatchesPage'
import { ResultPage } from './pages/ResultPage'

export default function App() {
  return (
    <PlayerProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="auth" element={<Navigate to="/" replace />} />
            <Route path="collection" element={<CollectionPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="party/:partyId" element={<Navigate to="/" replace />} />
            <Route path="room/:roomId" element={<MatchesPage />} />
            <Route
              path="room/:roomId/matches"
              element={<Navigate to=".." relative="path" replace />}
            />
            <Route path="room/:roomId/result" element={<ResultPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PlayerProvider>
  )
}
