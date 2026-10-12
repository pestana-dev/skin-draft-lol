import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuthProvider } from './contexts/AuthContext'
import { AuthPage } from './pages/AuthPage'
import { CollectionPage } from './pages/CollectionPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { LobbyPage } from './pages/LobbyPage'
import { ResultPage } from './pages/ResultPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="auth" element={<AuthPage />} />
            <Route path="collection" element={<CollectionPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="room/:roomId" element={<LobbyPage />} />
            <Route path="room/:roomId/result" element={<ResultPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
